/**
 * Grammar Checking Service
 * 
 * Uses the free LanguageTool public API (same API as modules/grammar/ uses internally).
 * No Java installation required — calls https://api.languagetool.org/v2/check
 * 
 * Features:
 *   - Spelling error detection
 *   - Grammar error detection
 *   - Style suggestions
 *   - Punctuation checks
 *   - Context-aware suggestions with replacements
 *   - Chunks text to stay within API limits
 */

const API_URL = 'https://api.languagetool.org/v2/check';
const MAX_TEXT_LENGTH = 20000; // API limit per request
const CHUNK_OVERLAP = 100; // Overlap between chunks to avoid missing errors at boundaries

/**
 * Split text into chunks that fit within API limits
 */
function chunkText(text, maxLength = MAX_TEXT_LENGTH) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    
    // Try to break at a sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      
      if (breakPoint > start + maxLength * 0.5) {
        end = breakPoint + 1;
      }
    }

    chunks.push({ text: text.substring(start, end), offset: start });
    start = end;
  }

  return chunks;
}

/**
 * Call the LanguageTool API for a single text chunk
 */
async function checkChunk(text, language = 'en-US') {
  const params = new URLSearchParams({
    text: text,
    language: language,
    enabledOnly: 'false',
  });

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    // If API is rate-limited or unavailable, fall back to basic checks
    if (response.status === 429 || response.status >= 500) {
      return fallbackGrammarCheck(text);
    }
    throw new Error(`LanguageTool API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fallback grammar check using basic regex patterns when API is unavailable
 */
function fallbackGrammarCheck(text) {
  const matches = [];
  const patterns = [
    { regex: /\b(their|there|they're)\b/gi, message: 'Check usage of their/there/they\'re', issueType: 'grammar' },
    { regex: /\b(your|you're)\b/gi, message: 'Check usage of your/you\'re', issueType: 'grammar' },
    { regex: /\b(its|it's)\b/gi, message: 'Check usage of its/it\'s', issueType: 'grammar' },
    { regex: /\s{2,}/g, message: 'Multiple spaces detected', issueType: 'whitespace' },
    { regex: /[.!?]\s*[a-z]/g, message: 'Sentence should start with a capital letter', issueType: 'typographical' },
    { regex: /\b(alot|doesnt|dont|cant|wont|shouldnt|couldnt|wouldnt)\b/gi, message: 'Missing apostrophe in contraction', issueType: 'misspelling' },
    { regex: /\bi\b(?!\.)(?!')/g, message: 'The pronoun "I" should be capitalized', issueType: 'grammar' },
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      matches.push({
        message: pattern.message,
        offset: match.index,
        length: match[0].length,
        context: {
          text: text.substring(Math.max(0, match.index - 20), Math.min(text.length, match.index + match[0].length + 20)),
          offset: Math.min(20, match.index),
          length: match[0].length
        },
        rule: {
          id: 'FALLBACK_' + pattern.issueType.toUpperCase(),
          issueType: pattern.issueType,
          category: { id: pattern.issueType.toUpperCase(), name: pattern.issueType }
        },
        replacements: []
      });
    }
  }

  return { matches, language: { name: 'English', code: 'en-US' }, software: { name: 'Fallback', version: '1.0' } };
}

/**
 * Categorize grammar issues
 */
function categorizeIssues(matches) {
  const categories = {
    spelling: { count: 0, issues: [] },
    grammar: { count: 0, issues: [] },
    style: { count: 0, issues: [] },
    punctuation: { count: 0, issues: [] },
    typography: { count: 0, issues: [] },
    other: { count: 0, issues: [] }
  };

  for (const match of matches) {
    const issueType = match.rule?.issueType || 'other';
    const category = match.rule?.category?.id || '';
    
    let bucket;
    if (issueType === 'misspelling' || category.includes('SPELL') || category.includes('TYPO')) {
      bucket = 'spelling';
    } else if (issueType === 'grammar' || category.includes('GRAMMAR')) {
      bucket = 'grammar';
    } else if (issueType === 'style' || category.includes('STYLE') || category.includes('REDUNDANCY')) {
      bucket = 'style';
    } else if (category.includes('PUNCT') || issueType === 'typographical') {
      bucket = 'punctuation';
    } else if (category.includes('TYPO') || issueType === 'whitespace') {
      bucket = 'typography';
    } else {
      bucket = 'other';
    }

    const issue = {
      message: match.message,
      context: match.context?.text || '',
      offset: match.offset,
      length: match.length,
      severity: issueType === 'misspelling' ? 'error' : issueType === 'grammar' ? 'warning' : 'suggestion',
      replacements: (match.replacements || []).slice(0, 5).map(r => r.value || r),
      ruleId: match.rule?.id || 'UNKNOWN',
      category: bucket
    };

    categories[bucket].issues.push(issue);
    categories[bucket].count++;
  }

  return categories;
}

/**
 * Calculate overall grammar quality score (0-100, higher = better)
 */
function calculateQualityScore(totalErrors, textLength) {
  if (textLength === 0) return 100;
  
  // Errors per 1000 characters
  const errorRate = (totalErrors / textLength) * 1000;
  
  // Score inversely proportional to error rate
  // 0 errors = 100, 10+ errors per 1000 chars = ~30
  const score = Math.max(0, Math.min(100, Math.round(100 - (errorRate * 7))));
  return score;
}

/**
 * Analyze text for grammar, spelling, and style issues
 * @param {string} text - The document text to analyze
 * @param {string} language - Language code (default: 'en-US')
 * @returns {Object} Grammar analysis results
 */
async function analyzeGrammar(text, language = 'en-US') {
  if (!text || text.trim().length === 0) {
    return {
      qualityScore: 100,
      totalErrors: 0,
      status: 'error',
      message: 'No text provided for analysis',
      categories: {},
      issues: [],
      apiUsed: 'none'
    };
  }

  try {
    const chunks = chunkText(text);
    let allMatches = [];
    let apiUsed = 'languagetool';

    // Process chunks (sequentially to respect rate limits)
    for (const chunk of chunks) {
      const chunkData = typeof chunk === 'string' ? { text: chunk, offset: 0 } : chunk;
      
      try {
        const result = await checkChunk(chunkData.text, language);
        
        if (result.software?.name === 'Fallback') {
          apiUsed = 'fallback';
        }

        // Adjust offsets for chunked text
        const adjustedMatches = (result.matches || []).map(match => ({
          ...match,
          offset: (match.offset || 0) + (chunkData.offset || 0)
        }));

        allMatches = allMatches.concat(adjustedMatches);
      } catch (err) {
        console.warn(`Grammar check chunk failed, using fallback:`, err.message);
        const fallback = fallbackGrammarCheck(chunkData.text);
        apiUsed = 'fallback';
        allMatches = allMatches.concat(fallback.matches || []);
      }
    }

    // De-duplicate matches at chunk boundaries
    const seen = new Set();
    allMatches = allMatches.filter(match => {
      const key = `${match.offset}-${match.length}-${match.rule?.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const categories = categorizeIssues(allMatches);
    const totalErrors = allMatches.length;
    const qualityScore = calculateQualityScore(totalErrors, text.length);

    let status, message;
    if (qualityScore >= 90) {
      status = 'excellent';
      message = 'Excellent writing quality. Very few issues detected.';
    } else if (qualityScore >= 70) {
      status = 'good';
      message = 'Good writing quality with some minor issues.';
    } else if (qualityScore >= 50) {
      status = 'fair';
      message = 'Fair writing quality. Several issues need attention.';
    } else {
      status = 'needs_improvement';
      message = 'Writing quality needs improvement. Multiple issues detected.';
    }

    // Build flat issues list sorted by offset
    const allIssues = Object.values(categories)
      .flatMap(cat => cat.issues)
      .sort((a, b) => a.offset - b.offset);

    return {
      qualityScore,
      totalErrors,
      status,
      message,
      categories: {
        spelling: categories.spelling.count,
        grammar: categories.grammar.count,
        style: categories.style.count,
        punctuation: categories.punctuation.count,
        typography: categories.typography.count,
        other: categories.other.count
      },
      issues: allIssues.slice(0, 50), // Cap at 50 issues for response size
      totalIssuesFound: allIssues.length,
      apiUsed,
      textLength: text.length
    };
  } catch (err) {
    console.error('Grammar analysis failed:', err);
    return {
      qualityScore: 0,
      totalErrors: 0,
      status: 'error',
      message: `Analysis failed: ${err.message}`,
      categories: {},
      issues: [],
      apiUsed: 'error'
    };
  }
}

module.exports = { analyzeGrammar };
