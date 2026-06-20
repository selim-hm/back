const asyncHandler = require("express-async-handler");
const axios = require("axios");
const prisma = require("../../config/prisma");

const WIKI_HEADERS = {
  "User-Agent": "KnowledgeAI/1.0 (Medical-Bot) axios/1.x",
};

function detectWikiLang(query, uiLang = "ar") {
  return /[\u0600-\u06FF]/.test(query) ? "ar" : uiLang;
}

function isTitleRelevant(hitTitle, query) {
  const titleLow = hitTitle.toLowerCase().replace(/[\u064B-\u065F]/g, "");
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return queryWords.some((word) => titleLow.includes(word.replace(/^ال/, "")));
}

function extractSummary(rawText, maxChars = 600) {
  if (!rawText) return "";
  const sentences = rawText.split(/(?<=[.!?؟])\s+/);
  let summary = "";
  for (const s of sentences) {
    if ((summary + s).length > maxChars) break;
    summary += (summary ? " " : "") + s.trim();
  }
  return summary || rawText.substring(0, maxChars) + "...";
}

async function searchWikipedia(query, lang) {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const candidates = [];
  for (let i = 0; i < words.length; i++) {
    candidates.push(words.slice(i).join(" "));
  }

  for (const term of candidates) {
    try {
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&utf8=&format=json&srlimit=5`;
      const searchResponse = await axios.get(searchUrl, {
        headers: WIKI_HEADERS,
      });
      const searchHits = searchResponse.data?.query?.search || [];

      if (searchHits.length === 0) continue;

      const relevantHits = searchHits.filter((hit) =>
        isTitleRelevant(hit.title, query),
      );
      if (relevantHits.length === 0) continue;

      for (const hit of relevantHits) {
        try {
          const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`;
          const summaryRes = await axios.get(summaryUrl, {
            headers: WIKI_HEADERS,
          });
          const data = summaryRes.data;

          if (
            data?.extract &&
            data.type !== "disambiguation" &&
            data.extract.length > 80
          ) {
            return {
              title: data.title,
              content: extractSummary(data.extract),
              source: "wikipedia",
            };
          }
        } catch (e) {
          if (e.response?.status !== 404)
            console.warn(`Wiki summary error "${hit.title}":`, e.message);
        }
      }
    } catch (e) {
      console.error("Wikipedia Search API error:", e.message);
    }
  }
  return null;
}

async function searchOpenFDA(query) {
  try {
    const lastWord = query.trim().split(/\s+/).pop();
    const fdaUrl = `https://api.fda.gov/drug/label.json?search=generic_name:"${encodeURIComponent(lastWord)}"&limit=1`;
    const fdaResponse = await axios.get(fdaUrl);
    if (fdaResponse.data?.results?.length > 0) {
      const drug = fdaResponse.data.results[0];
      const rawContent =
        drug.indications_and_usage?.[0] || drug.description?.[0] || "";
      return {
        title:
          drug.openfda?.brand_name?.[0] ||
          drug.openfda?.generic_name?.[0] ||
          lastWord,
        content: extractSummary(rawContent, 500),
        source: "openFDA",
      };
    }
  } catch (e) {
    if (e.response?.status !== 404)
      console.error("OpenFDA Search Error:", e.message);
  }
  return null;
}

/**
 * @desc    Drug Suggestions (Autocomplete)
 * @route   GET /api/knowledge/drugs/suggestions
 * @access  public
 */
exports.getDrugSuggestions = asyncHandler(async (req, res) => {
  const { query } = req.query;
  if (!query || query.length < 2) {
    return res.status(200).json([]);
  }

  try {
    // NIH RxTerms API for autocomplete
    const rxNavUrl = `https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=${encodeURIComponent(query)}&maxList=10`;
    const response = await axios.get(rxNavUrl);
    const [count, names] = response.data;
    res.status(200).json(names || []);
  } catch (error) {
    console.error("Drug suggestions error:", error.message);
    res.status(500).json({ message: "Failed to fetch suggestions" });
  }
});

/**
 * @desc    Get full drug details
 * @route   GET /api/knowledge/drugs/details
 * @access  public
 */
exports.getDrugDetails = asyncHandler(async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ message: "Drug name is required" });
  }

  try {
    const apiKey = process.env.OPENFDA_API_KEY;
    const apiKeyParam = apiKey ? `&api_key=${apiKey}` : "";

    // Search OpenFDA for full label info
    const fdaUrl = `https://api.fda.gov/drug/label.json?search=(openfda.brand_name:"${encodeURIComponent(name)}"+OR+openfda.generic_name:"${encodeURIComponent(name)}")&limit=1${apiKeyParam}`;
    const response = await axios.get(fdaUrl);

    if (response.data?.results?.length > 0) {
      const drug = response.data.results[0];
      const info = {
        name:
          drug.openfda?.brand_name?.[0] ||
          drug.openfda?.generic_name?.[0] ||
          name,
        generic_name: drug.openfda?.generic_name?.[0],
        manufacturer: drug.openfda?.manufacturer_name?.[0],
        indications: drug.indications_and_usage?.[0],
        dosage: drug.dosage_and_administration?.[0],
        warnings: drug.warnings?.[0],
        side_effects: drug.adverse_reactions?.[0],
        contraindications: drug.contraindications?.[0],
        description: drug.description?.[0],
        how_supplied: drug.how_supplied?.[0],
        storage: drug.storage_and_handling?.[0],
        pharmacology: drug.clinical_pharmacology?.[0],
      };
      res.status(200).json(info);
    } else {
      res.status(404).json({ message: "Drug details not found" });
    }
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ message: "Drug details not found" });
    }
    console.error("Drug details error:", error.message);
    res.status(500).json({ message: "Failed to fetch drug details" });
  }
});

/**
 * @desc    Search knowledge base (Local and External)
 * @route   GET /api/knowledge/search
 * @access  public
 */
exports.searchKnowledge = asyncHandler(async (req, res) => {
  const { query, lang: uiLang = "ar" } = req.query;

  if (!query) {
    return res.status(400).json({ message: "Please provide a search query" });
  }

  const wikiLang = detectWikiLang(query, uiLang);
  let results = [];

  // 1. Local Database — Prisma full-text search via contains (PostgreSQL mode: insensitive)
  const localResults = await prisma.knowledgeArticle.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { content: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 3,
  });

  if (localResults.length > 0) {
    results = localResults.map((r) => ({
      title: r.title,
      content: extractSummary(r.content),
      source: "local",
      category: r.category,
      language: r.language,
    }));
  }

  // 2. Wikipedia
  if (results.length === 0) {
    const wikiResult = await searchWikipedia(query, wikiLang);
    if (wikiResult) {
      results.push({ ...wikiResult, category: "medical", language: wikiLang });
    }
  }

  // 3. OpenFDA for drug-related queries
  const isDrugQuery = /drug|دواء|medication|medicine|tablet|capsule|دوا/i.test(
    query,
  );
  if (results.length === 0 || isDrugQuery) {
    const fdaResult = await searchOpenFDA(query);
    if (fdaResult) {
      results.push({ ...fdaResult, category: "drug", language: "en" });
    }
  }

  res.status(200).json({ query, count: results.length, results });
});

/**
 * @desc    Add a local knowledge article
 * @route   POST /api/knowledge
 * @access  private (Admin or Professional)
 */
exports.addKnowledgeArticle = asyncHandler(async (req, res) => {
  const { title, content, category, tags, language } = req.body;
  const userId = req.user.id || req.user._id;

  if (!title || !content) {
    return res.status(400).json({ message: "Title and content are required." });
  }

  const article = await prisma.knowledgeArticle.create({
    data: {
      title,
      content,
      category,
      tags: tags || [],
      language: language || "ar",
      authorId: userId,
      source: "local",
    },
  });

  res.status(201).json({ ...article, _id: article.id });
});
