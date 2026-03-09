'use strict';

/**
 * Semantic clustering for ideas using TF-IDF-like term vectors
 * and single-linkage agglomerative clustering.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'no', 'so',
  'if', 'then', 'than', 'too', 'very', 'just', 'about', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our',
  'you', 'your', 'he', 'she', 'they', 'them', 'their', 'what', 'which',
  'who', 'how', 'when', 'where', 'why', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'up', 'out', 'off', 'over', 'under', 'again', 'further', 'once'
]);

const SIMILARITY_THRESHOLD = 0.25;

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function extractTerms(idea) {
  const parts = [];
  if (idea.title) parts.push(idea.title);
  if (idea.problem) parts.push(idea.problem);
  if (Array.isArray(idea.tags)) parts.push(idea.tags.join(' '));
  if (Array.isArray(idea.signals)) {
    for (const sig of idea.signals) {
      if (sig.extractedPain) parts.push(sig.extractedPain);
      if (sig.extractedUseCase) parts.push(sig.extractedUseCase);
    }
  }
  return tokenize(parts.join(' '));
}

function buildTfVector(terms) {
  const tf = new Map();
  for (const term of terms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }
  return tf;
}

function buildIdf(documents) {
  const docCount = documents.length;
  const df = new Map();
  for (const terms of documents) {
    const unique = new Set(terms);
    for (const term of unique) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [term, count] of df) {
    idf.set(term, Math.log((docCount + 1) / (count + 1)) + 1);
  }
  return idf;
}

function buildTfIdfVector(tf, idf) {
  const vec = new Map();
  for (const [term, freq] of tf) {
    const idfVal = idf.get(term) || 1;
    vec.set(term, freq * idfVal);
  }
  return vec;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, valA] of a) {
    normA += valA * valA;
    const valB = b.get(term) || 0;
    dot += valA * valB;
  }
  for (const [, valB] of b) {
    normB += valB * valB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0.0;
  const sim = dot / denom;
  return Math.round(sim * 1e10) / 1e10;
}

function clusterIdeas(ideas) {
  if (!ideas || ideas.length === 0) return [];

  // Extract terms and build vectors
  const allTerms = ideas.map(idea => extractTerms(idea));
  const idf = buildIdf(allTerms);
  const vectors = allTerms.map(terms => buildTfIdfVector(buildTfVector(terms), idf));

  // Initialize: each idea in its own cluster
  const clusters = ideas.map((idea, i) => ({
    indices: [i],
    ideas: [idea]
  }));

  // Single-linkage agglomerative clustering
  let merged = true;
  while (merged) {
    merged = false;
    let bestI = -1;
    let bestJ = -1;
    let bestSim = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        // Single-linkage: max similarity between any pair across clusters
        let maxSim = 0;
        for (const idxA of clusters[i].indices) {
          for (const idxB of clusters[j].indices) {
            const sim = cosineSimilarity(vectors[idxA], vectors[idxB]);
            if (sim > maxSim) maxSim = sim;
          }
        }
        if (maxSim >= SIMILARITY_THRESHOLD && maxSim > bestSim) {
          bestSim = maxSim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestI >= 0) {
      // Merge bestJ into bestI
      clusters[bestI].indices.push(...clusters[bestJ].indices);
      clusters[bestI].ideas.push(...clusters[bestJ].ideas);
      clusters.splice(bestJ, 1);
      merged = true;
    }
  }

  // Assign labels based on most frequent term in cluster
  return clusters.map(cluster => {
    const termFreq = new Map();
    for (const idx of cluster.indices) {
      for (const term of allTerms[idx]) {
        termFreq.set(term, (termFreq.get(term) || 0) + 1);
      }
    }
    let label = 'misc';
    let maxFreq = 0;
    for (const [term, freq] of termFreq) {
      if (freq > maxFreq) {
        maxFreq = freq;
        label = term;
      }
    }
    return {
      label,
      ideas: cluster.ideas,
      count: cluster.ideas.length
    };
  });
}

module.exports = { clusterIdeas, cosineSimilarity };
