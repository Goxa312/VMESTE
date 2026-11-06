"""Refresh the public Russian-language charts. Run manually with Python 3 from any directory."""
import html
import json
import re
import sys
import time
from datetime import date
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
AGENT = "TogetherTonight/1.0 (https://github.com/Goxa312/VMESTE)"
TARGET = ROOT / "lib" / "rankings.json"


def fetch(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=65) as response:
                return response.read().decode("utf-8")
        except (URLError, TimeoutError) as error:
            if attempt == 2 or isinstance(error, HTTPError) and error.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(3 * (attempt + 1))


def wiki(query):
    url = "https://query.wikidata.org/sparql?" + urlencode({"format": "json", "query": query})
    results = json.loads(fetch(url))["results"]["bindings"]
    return [{key: field["value"] for key, field in row.items()} for row in results]


def movies():
    # Start with the score statement to keep the query selective on the public service.
    records = wiki('''SELECT ?item ?score ?votes ?asof ?title WHERE {
      ?st pq:P447 wd:Q37312; pq:P7887 ?votes; ps:P444 ?score .
      FILTER(?votes >= 10000)
      ?item p:P444 ?st; wdt:P31 wd:Q11424; rdfs:label ?title .
      FILTER(LANG(?title)="ru")
      FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
      OPTIONAL { ?st pq:P585 ?asof }
    }''')
    latest = {}
    for row in records:
        match = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*/\s*10", row["score"].strip())
        if not match:
            continue
        score = float(match[1].replace(",", "."))
        if not 0 < score <= 10:
            continue
        key = row["item"].rsplit("/", 1)[1]
        votes = int(float(row["votes"]))
        version = (row.get("asof", ""), votes)
        if key not in latest or latest[key][0] < version:
            latest[key] = (version, {"id": key, "title": row["title"], "score": score, "votes": votes})
    return sorted((entry for _, entry in latest.values()), key=lambda row: (-row["score"], -row["votes"], row["id"]))[:100]


def series():
    rows = {}
    for page in range(1, 31):
        url = "https://www.tvmaze.com/shows?" + urlencode({"Show[sort]": 7, "page": page})
        markup = fetch(url)
        matches = re.findall(r'<span class="title"><h2><a href="/shows/(\d+)/[^"]+".*?data-toggle="rate-\1">\s*<i[^>]*></i>\s*<span>([\d.]+)</span>', markup, re.S)
        if not matches:
            raise ValueError("TVmaze returned no rated shows")
        ids = " ".join(json.dumps(key) for key, _ in matches)
        titles = wiki('SELECT ?id ?title WHERE { VALUES ?id { ' + ids + ' } ?show wdt:P8600 ?id; rdfs:label ?title . FILTER(LANG(?title)="ru") }')
        names = {row["id"]: row["title"] for row in titles}
        for key, score in matches:
            if key in names and key not in rows:
                rows[key] = {"id": key, "title": html.unescape(names[key]), "score": float(score)}
        if len(rows) >= 100:
            break
        time.sleep(0.4)
    return sorted(rows.values(), key=lambda row: -row["score"])[:100]


def anime():
    rows = {}
    for page in range(1, 8):
        url = "https://shikimori.one/api/animes?" + urlencode({"order": "ranked", "status": "released", "censored": "true", "limit": 50, "page": page})
        for item in json.loads(fetch(url)):
            if item.get("russian") and 0 < float(item["score"]) <= 10:
                key = str(item["id"])
                rows[key] = {"id": key, "title": item["russian"], "score": float(item["score"])}
        if len(rows) >= 100:
            break
        time.sleep(0.5)
    return sorted(rows.values(), key=lambda row: -row["score"])[:100]

def add_display_titles(snapshot):
    """Keep the saved scores, ranks and snapshot date when adding another display language."""
    def films():
        for start in range(0, len(snapshot["film"]), 50):
            batch = snapshot["film"][start:start+50]
            params = {"action":"wbgetentities","format":"json","ids":"|".join(r["id"] for r in batch),
                      "props":"labels|sitelinks","languages":"en|mul","sitefilter":"enwiki"}
            entities = json.loads(fetch("https://www.wikidata.org/w/api.php?" + urlencode(params)))["entities"]
            for row in batch:
                item = entities[row["id"]]
                article = item.get("sitelinks", {}).get("enwiki", {}).get("title", "")
                label = item.get("labels", {}).get("en", {}).get("value")
                row["titleEn"] = label or re.sub(r" \([^()]*film\)$", "", article) or item["labels"]["mul"]["value"]
    def tv():
        for row in snapshot["series"]:
            name = json.loads(fetch("https://api.tvmaze.com/shows/" + row["id"]))["name"]
            if re.search(r"[^\x00-\x7f]", name) and not re.search("[a-zA-Z]", name):
                titles = wiki('SELECT ?title WHERE { ?item wdt:P8600 ' + json.dumps(row["id"]) +
                              ' . ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title . }')
                if titles:
                    name = titles[0]["title"]
            row["titleEn"] = name
            time.sleep(0.4)
    def japan():
        for row in snapshot["anime"]:
            item = json.loads(fetch("https://shikimori.one/api/animes/" + row["id"]))
            row["titleEn"] = next((v for v in (item.get("english") or []) if v), item["name"])
            time.sleep(0.65)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for job in [pool.submit(fn) for fn in (films,tv,japan)]:
            job.result()

if __name__ == "__main__":
    if "--titles-only" in sys.argv:
        result = json.loads(TARGET.read_text(encoding="utf-8"))
    else:
        result = {"date": date.today().isoformat()}
        for kind, reader in (("film", movies), ("series", series), ("anime", anime)):
            rows = reader()
            if len(rows) != 100 or len({row["id"] for row in rows}) != 100:
                raise ValueError(f"Incomplete {kind} chart ({len(rows)} items)")
            if any(not row["title"].strip() or not 0 < row["score"] <= 10 for row in rows):
                raise ValueError(f"Invalid {kind} chart")
            print(f"{kind}: {len(rows)} sourced entries", flush=True)
            result[kind] = rows
    add_display_titles(result)
    temporary = TARGET.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(TARGET)
