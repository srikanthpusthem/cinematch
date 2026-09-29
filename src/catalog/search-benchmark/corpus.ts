// Search benchmark corpus v1.0.0. Titles and years are public facts about
// well-known films and series; records marked (synthetic) are invented to
// exercise the exclusion policy. Changing expectations requires a version bump.
import {
  QUERY_RULES,
  SEARCH_BENCHMARK_VERSION,
  type BenchmarkCase,
  type BenchmarkCorpus,
  type BenchmarkTitle,
  type TitleKind,
} from "./types";

function t(
  id: string,
  kind: TitleKind,
  title: string,
  year: number,
  extra: Partial<BenchmarkTitle> = {},
): BenchmarkTitle {
  return {
    id,
    kind,
    title,
    originalTitle: null,
    alternateTitles: [],
    year,
    posterPath: `/${id.replace(/[^a-z0-9]/g, "")}.jpg`,
    adult: false,
    eligible: true,
    ...extra,
  };
}

const titles: BenchmarkTitle[] = [
  // Same names across years and kinds.
  t("m-dune-1984", "movie", "Dune", 1984),
  t("m-dune-2021", "movie", "Dune", 2021),
  t("m-dune-part-two", "movie", "Dune: Part Two", 2024),
  t("s-dune-prophecy", "series", "Dune: Prophecy", 2024),
  t("s-office-us", "series", "The Office", 2005, {
    alternateTitles: ["The Office (US)"],
  }),
  t("s-office-uk", "series", "The Office", 2001, {
    alternateTitles: ["The Office (UK)"],
  }),
  // Exclusion policy.
  t("m-heat-1995", "movie", "Heat", 1995),
  t("m-the-heat-2013", "movie", "The Heat", 2013),
  t("m-heat-ineligible", "movie", "Heat", 1986, { eligible: false }), // (synthetic flag)
  t("m-adult-heatwave", "movie", "Heatwave After Dark", 2003, { adult: true }), // (synthetic)
  // Prefix and token families.
  t("m-star-wars", "movie", "Star Wars", 1977),
  t("m-star-trek", "movie", "Star Trek", 2009),
  t("m-a-star-is-born", "movie", "A Star Is Born", 2018),
  t("m-stardust", "movie", "Stardust", 2007),
  t("s-star-trek-tng", "series", "Star Trek: The Next Generation", 1987),
  t("s-clone-wars", "series", "Star Wars: The Clone Wars", 2008),
  t("m-interstellar", "movie", "Interstellar", 2014),
  t("m-godfather", "movie", "The Godfather", 1972),
  t("m-godfather-2", "movie", "The Godfather Part II", 1974),
  t("s-breaking-bad", "series", "Breaking Bad", 2008),
  t("s-better-call-saul", "series", "Better Call Saul", 2015),
  // Very short titles.
  t("m-her", "movie", "Her", 2013),
  t("m-hereditary", "movie", "Hereditary", 2018),
  t("m-up", "movie", "Up", 2009),
  t("m-it", "movie", "It", 2017),
  t("m-it-follows", "movie", "It Follows", 2014),
  // Punctuation.
  t("m-spider-man", "movie", "Spider-Man", 2002),
  t("m-spider-verse", "movie", "Spider-Man: Into the Spider-Verse", 2018),
  t("m-wall-e", "movie", "WALL·E", 2008),
  t("s-mash", "series", "M*A*S*H", 1972),
  t("m-se7en", "movie", "Se7en", 1995, { alternateTitles: ["Seven"] }),
  // Original titles, diacritics and non-Latin scripts.
  t("m-amelie", "movie", "Amélie", 2001, {
    originalTitle: "Le Fabuleux Destin d’Amélie Poulain",
  }),
  t("m-spirited-away", "movie", "Spirited Away", 2001, {
    originalTitle: "千と千尋の神隠し",
    alternateTitles: ["Sen to Chihiro no Kamikakushi"],
  }),
  t("m-parasite", "movie", "Parasite", 2019, {
    originalTitle: "기생충",
    alternateTitles: ["Gisaengchung"],
  }),
  t("s-money-heist", "series", "Money Heist", 2017, {
    originalTitle: "La casa de papel",
  }),
  t("m-leon", "movie", "Léon: The Professional", 1994, {
    originalTitle: "Léon",
  }),
  t("m-pokemon-movie", "movie", "Pokémon: The First Movie", 1998),
  t("s-pokemon", "series", "Pokémon", 1997),
  t("s-dark", "series", "Dark", 2017),
  // Missing posters must not hide a title.
  t("m-primer", "movie", "Primer", 2004, { posterPath: null }),
  t("s-severance", "series", "Severance", 2022, { posterPath: null }),
];

function c(
  id: string,
  category: BenchmarkCase["category"],
  query: string,
  groups: string[][],
  extra: Partial<BenchmarkCase> = {},
): BenchmarkCase {
  const outcome = extra.outcome ?? (groups.length ? "results" : "empty");
  return {
    id,
    category,
    severity: "required",
    query,
    groups,
    outcome,
    note: "",
    ...extra,
  };
}

const cases: BenchmarkCase[] = [
  // Exact titles, case-insensitive; exact beats prefix.
  c("exact-interstellar", "exact", "Interstellar", [["m-interstellar"]]),
  c("exact-mixed-case", "exact", "iNtErStElLaR", [["m-interstellar"]]),
  c("exact-short-her", "exact", "her", [["m-her"], ["m-hereditary"]], {
    note: "Two-letter-plus exact title outranks a longer prefix match.",
  }),
  c("exact-two-letters", "exact", "up", [["m-up"]]),
  c("exact-it", "exact", "it", [["m-it"], ["m-it-follows"]]),
  c(
    "exact-leading-article",
    "exact",
    "godfather",
    [["m-godfather"], ["m-godfather-2"]],
    {
      note: "A leading article shouldn't stop the closest title ranking first.",
    },
  ),
  // Prefixes.
  c("prefix-partial-word", "prefix", "inters", [["m-interstellar"]]),
  c("prefix-multi-word", "prefix", "star w", [["m-star-wars", "s-clone-wars"]]),
  c("prefix-break", "prefix", "break", [["s-breaking-bad"]]),
  // Original and alternate titles.
  c("original-french", "original_title", "Le Fabuleux Destin", [["m-amelie"]]),
  c("original-japanese", "original_title", "千と千尋", [["m-spirited-away"]]),
  c("original-korean", "original_title", "기생충", [["m-parasite"]]),
  c("original-spanish", "original_title", "la casa de papel", [
    ["s-money-heist"],
  ]),
  c("alternate-romanized", "alternate_title", "Sen to Chihiro", [
    ["m-spirited-away"],
  ]),
  c("alternate-seven", "alternate_title", "seven", [["m-se7en"]]),
  // Punctuation-insensitive matching.
  c("punct-hyphen-as-space", "punctuation", "spider man", [
    ["m-spider-man"],
    ["m-spider-verse"],
  ]),
  c(
    "punct-hyphen-removed",
    "punctuation",
    "spiderman",
    [["m-spider-man"], ["m-spider-verse"]],
    {
      severity: "stretch",
      note: "Joined words need compound matching.",
    },
  ),
  c("punct-interpunct", "punctuation", "wall e", [["m-wall-e"]]),
  c("punct-interpunct-joined", "punctuation", "walle", [["m-wall-e"]], {
    severity: "stretch",
  }),
  c("punct-asterisks", "punctuation", "mash", [["s-mash"]]),
  c("punct-colon", "punctuation", "dune part two", [["m-dune-part-two"]]),
  // Diacritics and Unicode normalization.
  c("unicode-no-accent", "unicode", "amelie", [["m-amelie"]]),
  c("unicode-decomposed-query", "unicode", "Ame\u0301lie", [["m-amelie"]], {
    note: "NFD query must match the NFC title.",
  }),
  c("unicode-pokemon", "unicode", "pokemon", [
    ["s-pokemon"],
    ["m-pokemon-movie"],
  ]),
  c("unicode-leon", "unicode", "leon", [["m-leon"]]),
  // Common misspellings (stretch: need fuzzy matching).
  c("typo-interstelar", "misspelling", "interstelar", [["m-interstellar"]], {
    severity: "stretch",
  }),
  c(
    "typo-godfater",
    "misspelling",
    "godfater",
    [["m-godfather"], ["m-godfather-2"]],
    {
      severity: "stretch",
    },
  ),
  c("typo-transposition", "misspelling", "brekaing bad", [["s-breaking-bad"]], {
    severity: "stretch",
  }),
  // Movies vs series.
  c(
    "kind-series-only",
    "kind_filter",
    "the office",
    [["s-office-us", "s-office-uk"]],
    {
      kind: "series",
    },
  ),
  c("kind-no-movie-match", "kind_filter", "the office", [], { kind: "movie" }),
  c(
    "kind-excludes-other-kind",
    "kind_filter",
    "star trek",
    [["s-star-trek-tng"]],
    {
      kind: "series",
      forbidden: ["m-star-trek"],
    },
  ),
  // Same name across years.
  c("same-name-dune", "same_name", "dune", [
    ["m-dune-1984", "m-dune-2021"],
    ["m-dune-part-two", "s-dune-prophecy"],
  ]),
  c("same-name-office", "same_name", "the office", [
    ["s-office-us", "s-office-uk"],
  ]),
  // Missing posters.
  c("no-poster-movie", "missing_poster", "primer", [["m-primer"]]),
  c("no-poster-series", "missing_poster", "severance", [["s-severance"]]),
  // Exclusion policy: adult and ineligible records never appear.
  c("exclude-heat", "exclusion", "heat", [["m-heat-1995", "m-the-heat-2013"]], {
    note: "The 1986 Heat is ineligible and the adult title must never appear.",
  }),
  c("exclude-adult-only-match", "exclusion", "heatwave", []),
  // Zero results.
  c("zero-gibberish", "zero_result", "qwxzvbnm", []),
  c("zero-sql-looking", "malformed", "'; drop table titles;--", [], {
    note: "Treated as ordinary text: no error, no results.",
  }),
  // Short, long and malformed queries.
  c("short-one-char", "short_query", "a", [], { outcome: "invalid" }),
  c("short-whitespace", "short_query", "   ", [], { outcome: "invalid" }),
  c("short-empty", "short_query", "", [], { outcome: "invalid" }),
  c("long-at-limit", "long_query", "z".repeat(QUERY_RULES.maxLength), [], {
    note: "Exactly the maximum length is valid.",
  }),
  c(
    "long-over-limit",
    "long_query",
    "z".repeat(QUERY_RULES.maxLength + 1),
    [],
    {
      outcome: "invalid",
    },
  ),
  c("malformed-control-only", "malformed", "\u0000\u0007", [], {
    outcome: "invalid",
  }),
  c("malformed-control-inside", "malformed", "dune\u0000", [
    ["m-dune-1984", "m-dune-2021"],
    ["m-dune-part-two", "s-dune-prophecy"],
  ]),
  // Pagination.
  c(
    "page-star",
    "pagination",
    "star",
    [
      [
        "m-star-wars",
        "m-star-trek",
        "m-stardust",
        "m-a-star-is-born",
        "s-star-trek-tng",
        "s-clone-wars",
      ],
    ],
    {
      pageSize: 2,
      note: "Pages must concatenate to the single-request order.",
    },
  ),
];

export const SEARCH_BENCHMARK_CORPUS: BenchmarkCorpus = {
  version: SEARCH_BENCHMARK_VERSION,
  titles,
  cases,
};
