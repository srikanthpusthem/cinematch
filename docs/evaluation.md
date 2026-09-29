# Recommendation evaluation corpus

The versioned corpus in
`src/server/recommender/evaluation/corpus.ts` is the fixed input for recommendation
quality comparisons. Version 1.0.0 contains 32 deterministic cases and 16 synthetic
titles. It includes cold start, seeded mainstream and niche taste, movies and series,
sparse services, genre exclusions, watched suppression, conflicting constraints and
intentional shortages. The fixtures contain no personal data and require no network,
provider, database or paid-service access.

Cases define a candidate pool and partition it into titles that do and do not satisfy
hard constraints. They do not prescribe one ranked list. Human reviewers use the
prompts in each case to judge reasonable orderings for relevance and diversity.
`validateEvaluationCorpus` rejects malformed cases, duplicate IDs, unknown fixture
references, incomplete candidate partitions and expectations that contradict the
declared hard constraints.

The versioned rubric in `rubric.ts` scores hard-filter validity, relevance, diversity,
explanation faithfulness, availability freshness and fallback behavior. An unknown or
ineligible result, or fabricated title/metadata in an explanation, is an automatic
failure. Scored dimensions use the documented 0–4 anchors; passing requires every
gate, at least 2 in every scored dimension and a macro-average of at least 3.0.

## Use in issue #22

Before running either ranker, record the corpus version, fixture version, rubric
version and code revisions. Run the deterministic baseline and improved ranker over
the same unmodified case objects. Record every returned ID, explanation, latency,
fallback and human score. Report all cases, macro-averages, gate failures and shortage
behavior; do not remove outliers or count a fabricated result as partially correct.

Do not edit version 1.0.0 after seeing ranker results. A necessary correction creates
a new semantic version with a written rationale. Keep old and new reports separate,
and rerun both rankers on the new version. This prevents tuning the benchmark to make
one implementation look better and keeps comparisons repeatable.
