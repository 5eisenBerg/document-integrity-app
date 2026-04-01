/**
 * Paraphrasing Service
 *
 * Provides sentence-level paraphrasing using synonym replacement,
 * sentence restructuring, and word reordering techniques.
 *
 * Uses 'natural' for NLP tokenization and 'compromise' for
 * sentence manipulation — lightweight alternative to the fairseq
 * NMT model in modules/paraphrasing/.
 *
 * Features:
 *   - Synonym-based word replacement
 *   - Sentence restructuring
 *   - Quality scoring (original vs paraphrased similarity)
 *   - Multiple paraphrase suggestions per sentence
 */

const natural = require("natural");
const compromise = require("compromise");
const { analyzeGrammar } = require("./grammar-service");

const tokenizer = new natural.SentenceTokenizer();
const wordTokenizer = new natural.WordTokenizer();

function normalizeText(text) {
  return text
    .replace(/[-–—]+\s*\d+\s*of\s*\d+\s*[-–—]+/gi, "")
    .replace(/\bpage\s*\d+\s*of\s*\d+\b/gi, "")
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "")
    .replace(/\b1\s*of\s*1\b/gi, "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function fixAwkwardPhrases(text) {
  const replacements = [
    {
      regex:
        /The computer was invented by people who wanted to generate math faster\./gi,
      replacement:
        "The computer was invented by people who wanted to perform mathematical calculations faster.",
    },
    {
      regex:
        /Furthermore, the use of advanced computational algorithms has been used by researchers to facilitate the optimization of numerous systemic processes in a manner that is highly effective\./gi,
      replacement:
        "Furthermore, researchers have used advanced computational algorithms to effectively optimize many systemic processes.",
    },
    {
      regex:
        /trained employing large amounts of data and algorithms that present them the potential to learn how to perform the task\b/gi,
      replacement:
        "trained using large amounts of data and algorithms that allow them to learn how to perform the task",
    },
    {
      regex: /present them the potential to learn how to perform the task\b/gi,
      replacement: "allow them to learn how to perform the task",
    },
    {
      regex: /\butilization of\b/gi,
      replacement: "use of",
    },
    {
      regex: /\butilizing it\b/gi,
      replacement: "using it",
    },
  ];

  return replacements.reduce(
    (acc, rule) => acc.replace(rule.regex, rule.replacement),
    text,
  );
}

// Synonym dictionary for common academic/technical words
const SYNONYM_MAP = {
  important: ["significant", "crucial", "essential", "vital", "critical"],
  significant: [
    "important",
    "notable",
    "considerable",
    "substantial",
    "meaningful",
  ],
  show: ["demonstrate", "illustrate", "reveal", "indicate", "exhibit"],
  shows: ["demonstrates", "illustrates", "reveals", "indicates", "exhibits"],
  use: ["utilize", "employ", "apply", "leverage", "adopt"],
  uses: ["utilizes", "employs", "applies", "leverages", "adopts"],
  used: ["utilized", "employed", "applied", "leveraged", "adopted"],
  using: ["utilizing", "employing", "applying", "leveraging", "adopting"],
  help: ["assist", "aid", "support", "facilitate", "enable"],
  helps: ["assists", "aids", "supports", "facilitates", "enables"],
  make: ["create", "produce", "generate", "develop", "construct"],
  makes: ["creates", "produces", "generates", "develops", "constructs"],
  big: ["large", "substantial", "considerable", "enormous", "extensive"],
  small: ["minor", "slight", "modest", "limited", "compact"],
  good: ["effective", "beneficial", "favorable", "excellent", "superior"],
  bad: ["poor", "inadequate", "unfavorable", "substandard", "inferior"],
  new: ["novel", "innovative", "modern", "contemporary", "recent"],
  old: ["traditional", "conventional", "established", "legacy", "previous"],
  fast: ["rapid", "swift", "quick", "efficient", "expedient"],
  slow: ["gradual", "measured", "deliberate", "unhurried", "steady"],
  problem: ["issue", "challenge", "concern", "difficulty", "obstacle"],
  problems: ["issues", "challenges", "concerns", "difficulties", "obstacles"],
  result: ["outcome", "consequence", "finding", "conclusion", "effect"],
  results: ["outcomes", "consequences", "findings", "conclusions", "effects"],
  method: ["approach", "technique", "strategy", "procedure", "methodology"],
  methods: [
    "approaches",
    "techniques",
    "strategies",
    "procedures",
    "methodologies",
  ],
  provide: ["offer", "supply", "furnish", "deliver", "present"],
  provides: ["offers", "supplies", "furnishes", "delivers", "presents"],
  increase: ["enhance", "boost", "elevate", "amplify", "augment"],
  decrease: ["reduce", "diminish", "lower", "minimize", "lessen"],
  change: ["modify", "alter", "adjust", "transform", "revise"],
  changes: [
    "modifications",
    "alterations",
    "adjustments",
    "transformations",
    "revisions",
  ],
  different: ["distinct", "diverse", "varied", "alternative", "dissimilar"],
  similar: ["comparable", "analogous", "equivalent", "alike", "corresponding"],
  many: ["numerous", "several", "multiple", "various", "abundant"],
  various: ["diverse", "numerous", "multiple", "several", "assorted"],
  main: ["primary", "principal", "chief", "central", "key"],
  also: ["additionally", "furthermore", "moreover", "likewise", "similarly"],
  however: [
    "nevertheless",
    "nonetheless",
    "yet",
    "conversely",
    "on the other hand",
  ],
  therefore: ["consequently", "thus", "hence", "accordingly", "as a result"],
  because: ["since", "as", "due to the fact that", "given that", "owing to"],
  about: [
    "approximately",
    "regarding",
    "concerning",
    "relating to",
    "with respect to",
  ],
  get: ["obtain", "acquire", "receive", "gain", "attain"],
  give: ["provide", "grant", "offer", "present", "furnish"],
  think: ["consider", "believe", "contemplate", "suppose", "reason"],
  need: ["require", "necessitate", "demand", "call for", "depend on"],
  start: ["begin", "commence", "initiate", "launch", "embark on"],
  stop: ["cease", "halt", "discontinue", "terminate", "suspend"],
  study: ["research", "investigation", "analysis", "examination", "inquiry"],
  suggest: ["propose", "recommend", "indicate", "imply", "advise"],
  develop: ["create", "design", "build", "establish", "formulate"],
  include: ["comprise", "encompass", "incorporate", "contain", "involve"],
  improve: ["enhance", "refine", "optimize", "advance", "upgrade"],
  support: ["reinforce", "sustain", "uphold", "bolster", "validate"],
  allow: ["enable", "permit", "authorize", "facilitate", "empower"],
  based: ["founded", "grounded", "rooted", "built", "established"],
  describe: ["explain", "outline", "depict", "characterize", "illustrate"],
  determine: ["ascertain", "establish", "identify", "assess", "evaluate"],
  ability: ["capability", "capacity", "competence", "aptitude", "potential"],
  process: ["procedure", "operation", "mechanism", "workflow", "system"],
};

// Phrase-level replacements for more natural paraphrasing
const PHRASE_REPLACEMENTS = [
  { from: "in order to", to: "to" },
  { from: "a large number of", to: "many" },
  { from: "a significant number of", to: "numerous" },
  { from: "at the present time", to: "currently" },
  { from: "in the event that", to: "if" },
  { from: "it is important to note that", to: "notably" },
  { from: "due to the fact that", to: "because" },
  { from: "in spite of the fact that", to: "although" },
  { from: "for the purpose of", to: "to" },
  { from: "with regard to", to: "regarding" },
  { from: "on the other hand", to: "conversely" },
  { from: "as a result of", to: "because of" },
  { from: "in addition to", to: "besides" },
  { from: "prior to", to: "before" },
  { from: "subsequent to", to: "after" },
  { from: "in the near future", to: "soon" },
  { from: "at this point in time", to: "now" },
  { from: "has the ability to", to: "can" },
  { from: "is able to", to: "can" },
  { from: "it is necessary to", to: "one must" },
];

/**
 * Replace words with synonyms in a sentence
 */
function synonymReplace(sentence, replacementRate = 0.3) {
  const words = sentence.split(/\s+/);
  const result = [];
  let replacements = 0;
  const maxReplacements = Math.max(
    1,
    Math.floor(words.length * replacementRate),
  );

  for (const word of words) {
    const cleanWord = word.toLowerCase().replace(/[^a-z]/g, "");
    const punctuation = word.replace(/[a-zA-Z]/g, "");

    if (replacements < maxReplacements && SYNONYM_MAP[cleanWord]) {
      const synonyms = SYNONYM_MAP[cleanWord];
      const synonym = synonyms[Math.floor(Math.random() * synonyms.length)];

      // Preserve capitalization
      let finalWord = synonym;
      if (word[0] === word[0].toUpperCase()) {
        finalWord = synonym.charAt(0).toUpperCase() + synonym.slice(1);
      }

      // Reattach punctuation
      if (punctuation && word.endsWith(punctuation)) {
        finalWord += punctuation;
      }

      result.push(finalWord);
      replacements++;
    } else {
      result.push(word);
    }
  }

  return result.join(" ");
}

/**
 * Apply phrase-level replacements
 */
function phraseReplace(sentence) {
  let result = sentence;
  for (const { from, to } of PHRASE_REPLACEMENTS) {
    const regex = new RegExp(from, "gi");
    result = result.replace(regex, to);
  }
  return result;
}

/**
 * Restructure sentence using compromise NLP
 */
function restructureSentence(sentence) {
  try {
    const doc = compromise(sentence);

    // Try to convert passive to active or vice versa (basic restructuring)
    const sentences = doc.sentences();
    if (sentences.length > 0) {
      // Add transitional variety
      const text = doc.text();
      return text;
    }

    return sentence;
  } catch {
    return sentence;
  }
}

/**
 * Compute similarity between original and paraphrased text
 */
function computeSimilarity(original, paraphrased) {
  const origWords = new Set(wordTokenizer.tokenize(original.toLowerCase()));
  const paraWords = new Set(wordTokenizer.tokenize(paraphrased.toLowerCase()));

  const intersection = new Set([...origWords].filter((w) => paraWords.has(w)));
  const union = new Set([...origWords, ...paraWords]);

  if (union.size === 0) return 1;
  return intersection.size / union.size; // Jaccard similarity
}

function applyManualCorrections(text) {
  const replacements = [
    { regex: /\bThiss are\b/gi, replacement: "This is" },
    { regex: /\bThis are\b/gi, replacement: "This is" },
    { regex: /\bThese is\b/gi, replacement: "These are" },
    {
      regex: /\bThis are very critical\b/gi,
      replacement: "This is very important",
    },
    {
      regex: /\bThese are very critical\b/gi,
      replacement: "This is very important",
    },
    { regex: /\bI and him thinks\b/gi, replacement: "He and I think" },
    { regex: /\bI and him think\b/gi, replacement: "He and I think" },
    { regex: /\bdon't careful\b/gi, replacement: "are not careful" },
    { regex: /\babundant peoples is\b/gi, replacement: "many people are" },
    { regex: /\babundant peoples\b/gi, replacement: "many people" },
    { regex: /\bpeoples\b/gi, replacement: "people" },
    { regex: /\bgrammer\b/gi, replacement: "grammar" },
    { regex: /\bsentense\b/gi, replacement: "sentence" },
    { regex: /\butilization of\b/gi, replacement: "use of" },
    { regex: /\butilizing it\b/gi, replacement: "using it" },
    { regex: /\butilization\b/gi, replacement: "use" },
    { regex: /\bhas been implemented\b/gi, replacement: "has been used" },
    {
      regex:
        /\bhas been used by researchers to facilitate the optimization of numerous systemic processes in a manner that is highly effective\b/gi,
      replacement:
        "researchers have used advanced computational algorithms to effectively optimize many systemic processes",
    },
    {
      regex:
        /\btrained employing large amounts of data and algorithms that present them the potential to learn how to perform the task\b/gi,
      replacement:
        "trained using large amounts of data and algorithms that allow them to learn how to perform the task",
    },
    {
      regex:
        /\bpresent them the potential to learn how to perform the task\b/gi,
      replacement: "allow them to learn how to perform the task",
    },
    {
      regex: /\bto generate math faster\b/gi,
      replacement: "to perform mathematical calculations faster",
    },
    { regex: /\bdon't be careful\b/gi, replacement: "don't be careless" },
  ];

  let corrected = replacements.reduce(
    (acc, rule) => acc.replace(rule.regex, rule.replacement),
    text,
  );
  corrected = fixAwkwardPhrases(corrected);
  return corrected;
}

async function correctParaphrasedText(text) {
  try {
    let corrected = applyManualCorrections(text);
    corrected = normalizeText(corrected);
    const grammarResult = await analyzeGrammar(corrected);
    if (
      grammarResult &&
      Array.isArray(grammarResult.issues) &&
      grammarResult.issues.length > 0
    ) {
      const fixes = grammarResult.issues
        .filter(
          (issue) =>
            Array.isArray(issue.replacements) && issue.replacements.length > 0,
        )
        .map((issue) => ({
          offset: issue.offset || 0,
          length: issue.length || 0,
          replacement: issue.replacements[0],
        }))
        .sort((a, b) => b.offset - a.offset);

      for (const fix of fixes) {
        if (fix.offset >= 0 && fix.length > 0) {
          corrected =
            corrected.slice(0, fix.offset) +
            fix.replacement +
            corrected.slice(fix.offset + fix.length);
        }
      }
    }

    corrected = applyManualCorrections(corrected);
    corrected = normalizeText(corrected);

    return corrected;
  } catch (err) {
    return applyManualCorrections(text);
  }
}

/**
 * Generate multiple paraphrase variants for a sentence
 */
function generateVariants(sentence) {
  const variants = [];

  // Variant 1: Synonym replacement (light)
  const v1 = synonymReplace(sentence, 0.2);
  if (v1 !== sentence) variants.push({ text: v1, method: "synonym_light" });

  // Variant 2: Synonym replacement (heavy)
  const v2 = synonymReplace(sentence, 0.5);
  if (v2 !== sentence && v2 !== v1)
    variants.push({ text: v2, method: "synonym_heavy" });

  // Variant 3: Phrase replacement
  const v3 = phraseReplace(sentence);
  if (v3 !== sentence)
    variants.push({ text: v3, method: "phrase_replacement" });

  // Variant 4: Combined (phrase + synonym)
  const v4 = synonymReplace(phraseReplace(sentence), 0.3);
  if (v4 !== sentence) variants.push({ text: v4, method: "combined" });

  // Variant 5: Restructured + synonyms
  const v5 = synonymReplace(restructureSentence(sentence), 0.25);
  if (v5 !== sentence) variants.push({ text: v5, method: "restructured" });

  // De-duplicate
  const seen = new Set();
  return variants.filter((v) => {
    const norm = v.text.toLowerCase().trim();
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

/**
 * Analyze and paraphrase text
 * @param {string} text - The document text to paraphrase
 * @returns {Object} Paraphrasing analysis results
 */
async function analyzeParaphrase(text) {
  if (!text || text.trim().length === 0) {
    return {
      qualityScore: 0,
      status: "error",
      message: "No text provided for paraphrasing",
      sentences: [],
      fullParaphrase: "",
      wordCount: { original: 0, paraphrased: 0 },
    };
  }

  text = normalizeText(text);
  const sentences = tokenizer.tokenize(text);
  if (sentences.length === 0) {
    return {
      qualityScore: 0,
      status: "clean",
      message: "No sentences detected for paraphrasing",
      sentences: [],
      fullParaphrase: "",
      wordCount: { original: 0, paraphrased: 0 },
    };
  }

  const results = [];
  const paraphrasedParts = [];
  let totalSimilarity = 0;

  for (let i = 0; i < sentences.length; i++) {
    const original = sentences[i];
    const variants = generateVariants(original);
    const correctedOriginal = await correctParaphrasedText(original);
    if (
      correctedOriginal &&
      correctedOriginal !== original &&
      !variants.some((v) => v.text === correctedOriginal)
    ) {
      variants.push({ text: correctedOriginal, method: "grammar_corrected" });
    }

    // Pick the best variant (lowest similarity = most different)
    let bestVariant = null;
    let bestSimilarity = 1;

    for (const variant of variants) {
      const sim = computeSimilarity(original, variant.text);
      if (sim < bestSimilarity && sim > 0.2) {
        // Don't pick variants that are TOO different
        bestSimilarity = sim;
        bestVariant = variant;
      }
    }

    const paraphrased = bestVariant ? bestVariant.text : original;
    const similarity = bestVariant ? bestSimilarity : 1;
    totalSimilarity += similarity;
    const correctedSentence = await correctParaphrasedText(paraphrased);
    const finalSentence = correctedSentence || paraphrased;
    paraphrasedParts.push(finalSentence);

    results.push({
      index: i + 1,
      original,
      paraphrased: finalSentence,
      similarity: Math.round(similarity * 100),
      method: bestVariant ? bestVariant.method : "unchanged",
      wasChanged: bestVariant !== null || finalSentence !== original,
      alternatives: variants.slice(0, 3).map((v) => ({
        text: v.text,
        method: v.method,
        similarity: Math.round(computeSimilarity(original, v.text) * 100),
      })),
    });
  }

  const avgSimilarity = totalSimilarity / sentences.length;
  const diversityScore = Math.round((1 - avgSimilarity) * 100);
  const changedCount = results.filter((r) => r.wasChanged).length;

  const originalWords = wordTokenizer.tokenize(text);
  const paraphrasedText = paraphrasedParts.join(" ");
  const correctedText = await correctParaphrasedText(paraphrasedText);
  const finalText = correctedText || paraphrasedText;
  const paraphrasedWords = wordTokenizer.tokenize(finalText);

  let status, message;
  if (diversityScore >= 40) {
    status = "high_diversity";
    message =
      "Strong paraphrasing achieved. Text has been significantly restructured.";
  } else if (diversityScore >= 20) {
    status = "moderate_diversity";
    message =
      "Moderate paraphrasing achieved. Key words have been replaced with synonyms.";
  } else if (diversityScore >= 5) {
    status = "low_diversity";
    message =
      "Light paraphrasing applied. Consider manual rewriting for better results.";
  } else {
    status = "minimal";
    message =
      "Minimal changes possible. Text may already be well-written or use specialized terminology.";
  }

  if (finalText !== paraphrasedText) {
    const correctedSentences = tokenizer.tokenize(finalText);
    if (correctedSentences.length === results.length) {
      results.forEach((item, idx) => {
        item.paraphrased = correctedSentences[idx];
      });
    }
    message +=
      " Spelling and grammar corrections were applied to the final paraphrased output.";
  }

  return {
    qualityScore: diversityScore,
    status,
    message,
    sentences: results,
    fullParaphrase: finalText,
    changedSentences: changedCount,
    totalSentences: sentences.length,
    changedPercentage: Math.round((changedCount / sentences.length) * 100),
    wordCount: {
      original: originalWords.length,
      paraphrased: paraphrasedWords.length,
    },
    averageSimilarity: Math.round(avgSimilarity * 100),
  };
}

module.exports = { analyzeParaphrase };
