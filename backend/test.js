const fs = require('fs');
const http = require('http');

const testText = `Machine learning is a subset of artificial intelligence that provides systems the ability to automatically learn and improve from experience without being explicitly programmed. Deep learning is part of a broader family of machine learning methods based on artificial neural networks. Natural language processing is a subfield of linguistics computer science and artificial intelligence concerned with the interactions between computers and human language. This sentense has a speling eror and bad grammer.`;

const log = [];
function print(msg) { log.push(msg); }

async function runTests() {
  // Test services directly
  const { analyzePlagiarism } = require('./services/plagiarism-service');
  const { analyzeGrammar } = require('./services/grammar-service');
  const { analyzeParaphrase } = require('./services/paraphrase-service');

  print('=== PLAGIARISM TEST ===');
  try {
    const plag = await analyzePlagiarism(testText);
    print('Score: ' + plag.overallScore + '%');
    print('Status: ' + plag.status);
    print('Flagged: ' + plag.flaggedCount + '/' + plag.totalSentences + ' sentences');
    print('Message: ' + plag.message);
  } catch(e) { print('ERROR: ' + e.message); }

  print('');
  print('=== GRAMMAR TEST ===');
  try {
    const gram = await analyzeGrammar(testText);
    print('Quality: ' + gram.qualityScore + '/100');
    print('Status: ' + gram.status);
    print('Total Errors: ' + gram.totalErrors);
    print('API Used: ' + gram.apiUsed);
    print('Categories: ' + JSON.stringify(gram.categories));
    if (gram.issues && gram.issues.length > 0) {
      print('Sample issues:');
      gram.issues.slice(0, 3).forEach(i => print('  - ' + i.message));
    }
  } catch(e) { print('ERROR: ' + e.message); }

  print('');
  print('=== PARAPHRASE TEST ===');
  try {
    const para = await analyzeParaphrase(testText);
    print('Diversity: ' + para.qualityScore + '%');
    print('Status: ' + para.status);
    print('Changed: ' + para.changedSentences + '/' + para.totalSentences);
    print('Preview: ' + (para.fullParaphrase || '').substring(0, 200));
  } catch(e) { print('ERROR: ' + e.message); }

  print('');
  print('=== ALL TESTS DONE ===');

  fs.writeFileSync('test_output.txt', log.join('\n'), 'utf8');
  process.exit(0);
}

runTests();
