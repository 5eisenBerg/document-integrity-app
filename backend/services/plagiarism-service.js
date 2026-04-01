/**
 * Plagiarism Detection Service
 * 
 * Uses TF-IDF vectorization + cosine similarity (same algorithm as modules/plagiarism/app.py)
 * Implemented in pure Node.js using the 'natural' NLP library.
 * 
 * Algorithm:
 *   1. Split document into sentences
 *   2. Build TF-IDF vectors for each sentence
 *   3. Compare against reference corpus (web snippets / known phrases)
 *   4. Compute cosine similarity scores
 *   5. Flag sentences above threshold as potentially plagiarized
 */

const natural = require('natural');
const TfIdf = natural.TfIdf;
const tokenizer = new natural.SentenceTokenizer();
const wordTokenizer = new natural.WordTokenizer();

// Reference corpus — common academic/web phrases that indicate potential plagiarism
const REFERENCE_CORPUS = [
  "Machine learning is a subset of artificial intelligence that provides systems the ability to automatically learn and improve from experience without being explicitly programmed",
  "Deep learning is part of a broader family of machine learning methods based on artificial neural networks with representation learning",
  "Natural language processing is a subfield of linguistics computer science and artificial intelligence concerned with the interactions between computers and human language",
  "Cloud computing is the on-demand availability of computer system resources especially data storage and computing power without direct active management by the user",
  "Blockchain is a growing list of records called blocks that are linked together using cryptography",
  "The Internet of Things describes physical objects with sensors processing ability software and other technologies that connect and exchange data with other devices",
  "Data science is an interdisciplinary field that uses scientific methods processes algorithms and systems to extract knowledge and insights from structured and unstructured data",
  "Cybersecurity is the practice of protecting systems networks and programs from digital attacks",
  "Quantum computing is a type of computation that harnesses the collective properties of quantum states such as superposition and entanglement to perform calculations",
  "Big data analytics is the process of examining large and varied data sets to uncover hidden patterns unknown correlations market trends customer preferences and other useful information",
  "Software engineering is the systematic application of engineering approaches to the development of software",
  "Computer vision is an interdisciplinary scientific field that deals with how computers can gain high-level understanding from digital images or videos",
  "Agile software development refers to a group of software development methodologies based on iterative development",
  "Version control is a system that records changes to a file or set of files over time so that you can recall specific versions later",
  "API stands for Application Programming Interface which is a set of protocols and tools for building software applications",
  "Microservices architecture is an approach to developing a single application as a suite of small services",
  "DevOps is a set of practices that combines software development and IT operations",
  "Containerization is a lightweight alternative to full machine virtualization that involves encapsulating an application in a container",
  "The document describes a process or methodology that has been widely adopted in the industry",
  "According to research published in various academic journals the findings suggest that this approach yields significant improvements",
  "In conclusion the results demonstrate that the proposed method outperforms existing approaches in terms of accuracy and efficiency",
  "This paper presents a comprehensive survey of the current state of the art methods and techniques",
  "The experimental results show that our proposed approach achieves superior performance compared to baseline methods",
  "Recent advances in technology have transformed the way organizations operate and deliver services",
  "The rapid growth of digital transformation has created new opportunities and challenges for businesses worldwide"
];

/**
 * Compute cosine similarity between two TF-IDF vectors
 */
function cosineSimilarity(vec1, vec2) {
  const terms = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (const term of terms) {
    const v1 = vec1[term] || 0;
    const v2 = vec2[term] || 0;
    dotProduct += v1 * v2;
    magnitude1 += v1 * v1;
    magnitude2 += v2 * v2;
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Build a TF-IDF vector for a given text
 */
function buildTfIdfVector(text, tfidf, docIndex) {
  const vector = {};
  const words = wordTokenizer.tokenize(text.toLowerCase());
  
  words.forEach(word => {
    const measure = tfidf.tfidf(word, docIndex);
    if (measure > 0) {
      vector[word] = measure;
    }
  });

  return vector;
}

/**
 * Analyze text for plagiarism
 * @param {string} text - The document text to analyze
 * @returns {Object} Plagiarism analysis results
 */
async function analyzePlagiarism(text) {
  if (!text || text.trim().length === 0) {
    return {
      overallScore: 0,
      status: 'error',
      message: 'No text provided for analysis',
      sentences: [],
      flaggedCount: 0,
      totalSentences: 0
    };
  }

  const sentences = tokenizer.tokenize(text);
  if (sentences.length === 0) {
    return {
      overallScore: 0,
      status: 'clean',
      message: 'No sentences detected',
      sentences: [],
      flaggedCount: 0,
      totalSentences: 0
    };
  }

  // Build TF-IDF model with reference corpus + document sentences
  const tfidf = new TfIdf();
  
  // Add reference corpus documents
  REFERENCE_CORPUS.forEach(doc => tfidf.addDocument(doc.toLowerCase()));
  
  // Add document sentences
  sentences.forEach(sentence => tfidf.addDocument(sentence.toLowerCase()));

  const results = [];
  let totalSimilarity = 0;
  let flaggedCount = 0;
  const PLAGIARISM_THRESHOLD = 0.35;

  for (let i = 0; i < sentences.length; i++) {
    const sentenceIndex = REFERENCE_CORPUS.length + i;
    const sentenceVector = buildTfIdfVector(sentences[i], tfidf, sentenceIndex);
    
    let maxSimilarity = 0;
    let matchedSource = '';

    // Compare against each reference document
    for (let j = 0; j < REFERENCE_CORPUS.length; j++) {
      const refVector = buildTfIdfVector(REFERENCE_CORPUS[j], tfidf, j);
      const similarity = cosineSimilarity(sentenceVector, refVector);
      
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        matchedSource = REFERENCE_CORPUS[j].substring(0, 80) + '...';
      }
    }

    // Also compare against other sentences in the document (self-plagiarism / repetition)
    for (let k = 0; k < sentences.length; k++) {
      if (k === i) continue;
      const otherIndex = REFERENCE_CORPUS.length + k;
      const otherVector = buildTfIdfVector(sentences[k], tfidf, otherIndex);
      const selfSim = cosineSimilarity(sentenceVector, otherVector);
      
      if (selfSim > 0.8 && selfSim > maxSimilarity) {
        maxSimilarity = Math.min(selfSim, 0.95);
        matchedSource = `[Self-repetition] Sentence ${k + 1}`;
      }
    }

    const isFlagged = maxSimilarity >= PLAGIARISM_THRESHOLD;
    if (isFlagged) flaggedCount++;
    totalSimilarity += maxSimilarity;

    results.push({
      index: i + 1,
      text: sentences[i],
      similarity: Math.round(maxSimilarity * 100),
      isFlagged,
      severity: maxSimilarity >= 0.7 ? 'high' : maxSimilarity >= 0.5 ? 'medium' : maxSimilarity >= PLAGIARISM_THRESHOLD ? 'low' : 'clean',
      matchedSource: isFlagged ? matchedSource : null
    });
  }

  const overallScore = Math.round((totalSimilarity / sentences.length) * 100);
  
  let status, message;
  if (overallScore >= 60) {
    status = 'high_plagiarism';
    message = 'High similarity detected. Significant portions may be plagiarized.';
  } else if (overallScore >= 30) {
    status = 'moderate_plagiarism';
    message = 'Moderate similarity detected. Some sentences may need rewriting.';
  } else if (overallScore >= 10) {
    status = 'low_plagiarism';
    message = 'Low similarity detected. Minor overlaps with common phrases.';
  } else {
    status = 'clean';
    message = 'Text appears original with minimal similarity to known sources.';
  }

  return {
    overallScore,
    status,
    message,
    sentences: results,
    flaggedCount,
    totalSentences: sentences.length,
    flaggedPercentage: Math.round((flaggedCount / sentences.length) * 100),
    threshold: PLAGIARISM_THRESHOLD * 100
  };
}

module.exports = { analyzePlagiarism };
