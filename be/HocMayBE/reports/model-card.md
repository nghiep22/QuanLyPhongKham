# Model card

- Method: word TF–IDF with L2 normalization and cosine ranking.
- Selected configuration: unigram {"minDf":3,"maxDf":0.95,"ngramMax":1}.
- Training/index corpus: 4616 original train and validation posts across 8 categories.
- Vocabulary: 14135 terms.
- Validation: model selected without inspecting final test metrics.
- Final held-out test (200 document-derived short queries): Precision@5 0.476, MRR 0.664, median search 2.9 ms, p95 6.1 ms.
- Baseline test: Precision@5 0.284, MRR 0.495.
- Manual 32-query category proxy: Precision@5 0.881, MRR 0.941.
- Limitations: English news discussions, lexical overlap rather than true semantic understanding, category labels used as relevance proxy, historical data and potentially sensitive or objectionable source content. No clinical advice.
- Safety: headers, quoted lines, email addresses and links removed before indexing; only snippets returned. Review source material before public deployment.
