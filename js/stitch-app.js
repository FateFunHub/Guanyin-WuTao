// 大觀音亭暨祀典興濟宮 — Stitch 原生版型控制器 (四語切換 + Web Speech API 真語音導讀 + #代號單獨呈現 + 3D Iframe 連動)
(function () {
  const LANG_MAP = { zh: "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
  const HTML_LANG = { zh: "zh-TW", en: "en", ja: "ja", ko: "ko" };

  let currentLang = "zh";
  let playbackRates = [1.0, 1.25, 1.5];
  let rateIdx = 0;

  // Web Speech API 狀態
  const tts = {
    activeKey: null,
    activeCard: null,
    isPlaying: false,
    isPaused: false,
    chunks: [],
    chunkStarts: [],
    totalChars: 0,
    estTotalSec: 0,
    chunkIdx: 0,
    chunkStartedAt: 0,
    utterToken: 0,
    isScrubbing: false,
    elapsed: 0,
    timer: null
  };

  function getInitialLang() {
    const p = new URLSearchParams(window.location.search).get("lang");
    if (p && LANG_MAP[p]) return p;
    try {
      const s = localStorage.getItem("guanyin_tour_lang");
      if (s && LANG_MAP[s]) return s;
    } catch (e) { }
    return "zh";
  }

  function i18n(key) {
    const d = (window.TOUR_I18N && window.TOUR_I18N[currentLang]) || (window.TOUR_I18N && window.TOUR_I18N.zh) || {};
    return d[key] || (window.TOUR_I18N && window.TOUR_I18N.zh && window.TOUR_I18N.zh[key]) || key;
  }

  function getItem(code) {
    if (!code || !window.TOUR_ITEMS_MAP) return null;
    return window.TOUR_ITEMS_MAP[String(code).toUpperCase()] || null;
  }

  // =========================================================
  // Web Speech API 真語音合成朗讀 (含自然語音優先、破音字校正與進度條跳轉)
  // =========================================================
  function pickVoice(langCode) {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const norm = langCode.toLowerCase();
    const prefix = norm.split("-")[0];

    const candidates = voices.filter(v => {
      const vl = (v.lang || "").replace("_", "-").toLowerCase();
      return vl === norm || vl.startsWith(prefix);
    });
    if (!candidates.length) return null;

    const scoreVoice = v => {
      const vl = (v.lang || "").replace("_", "-").toLowerCase();
      const name = (v.name || "").toLowerCase();
      let s = 0;
      if (vl === norm) s += 100;
      if (name.includes("natural") || name.includes("online")) s += 60;
      if (name.includes("hsiaochen") || name.includes("hsiaoyu") || name.includes("yunjhe")) s += 50;
      if (name.includes("google") && vl.includes("tw")) s += 45;
      if (name.includes("meijia") || name.includes("sinji")) s += 35;
      if (name.includes("hanhan") || name.includes("zhiwei") || name.includes("desktop")) s -= 30;
      return s;
    };

    candidates.sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return candidates[0] || null;
  }

  function prepareSpeechText(text, lang) {
    if (!text) return "";
    let s = text;
    if (lang === "zh") {
      // 古蹟與佛道專有名詞破音字、罕見字讀音校正（僅影響語音朗讀，不改動畫面文字）
      const lexicon = [
        [/吳夲/g, "吳滔"],
        [/夲/g, "滔"],
        [/伽藍/g, "茄藍"],
        [/重[簷檐]/g, "蟲簷"],
        [/吽/g, "轟"],
        [/咾咕石/g, "老孤石"],
        [/咾咕/g, "老孤"],
        [/斗栱/g, "斗拱"],
        [/戧脊/g, "嗆脊"],
        [/懸魚/g, "玄魚"],
        [/山門護法[——\-]+/g, "山門護法，"],
        [/[（(](?:A|HUM|GY-?\d+|XJ-?\d+|A\d+)[）)]/gi, ""],
        [/\b(?:GY|XJ|A)-?\d{1,2}\b/gi, ""]
      ];
      lexicon.forEach(([re, rep]) => {
        s = s.replace(re, rep);
      });
      s = s.replace(/[・｜\/]/g, "，").replace(/——/g, "，");
    }
    return s.replace(/\s+/g, " ").trim();
  }

  function charsPerSecond(lang) {
    if (lang === "en") return 14;
    if (lang === "ko") return 3.8;
    if (lang === "ja") return 4.2;
    return 4.3;
  }

  function splitSentences(text, lang) {
    if (!text) return [];
    const raw = lang === "en"
      ? text.split(/(?<=[.!?;])\s+/).map(s => s.trim()).filter(Boolean)
      : text.split(/(?<=[。！？；\n])/).map(s => s.trim()).filter(Boolean);

    // 將短句合併為約 120～140 字（英文約 260 字）的適中段落，大幅減少段落切換停頓並避免瀏覽器長句中斷
    const maxLen = lang === "en" ? 260 : 135;
    const joiner = lang === "en" ? " " : "";
    const grouped = [];
    let buf = "";
    for (const s of raw) {
      if (buf && (buf.length + s.length + joiner.length) > maxLen) {
        grouped.push(buf);
        buf = s;
      } else {
        buf = buf ? (buf + joiner + s) : s;
      }
    }
    if (buf) grouped.push(buf);
    return grouped;
  }

  function formatMMSS(sec) {
    const safe = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }

  function computeProgressFraction() {
    if (!tts.isPlaying || !tts.totalChars) return 0;
    const idx = Math.min(tts.chunkIdx, tts.chunks.length - 1);
    const startChar = tts.chunkStarts[idx] || 0;
    const endChar = tts.chunkStarts[idx + 1] || tts.totalChars;
    const startFrac = startChar / tts.totalChars;
    const endFrac = endChar / tts.totalChars;

    let inChunkRatio = 0;
    if (tts.chunkStartedAt && !tts.isPaused) {
      const rate = playbackRates[rateIdx] || 1.0;
      const chunkLen = Math.max(1, (tts.chunks[idx] || "").length);
      const estChunkMs = ((chunkLen / charsPerSecond(currentLang)) / rate) * 1000;
      const dt = Math.max(0, Date.now() - tts.chunkStartedAt);
      inChunkRatio = Math.min(0.96, dt / Math.max(400, estChunkMs));
    }
    return Math.max(0, Math.min(1, startFrac + inChunkRatio * (endFrac - startFrac)));
  }

  function stopSpeech() {
    tts.utterToken += 1;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (tts.timer) {
      clearInterval(tts.timer);
      tts.timer = null;
    }
    const prevCard = tts.activeCard;
    tts.activeKey = null;
    tts.activeCard = null;
    tts.isPlaying = false;
    tts.isPaused = false;
    tts.chunks = [];
    tts.chunkStarts = [];
    tts.totalChars = 0;
    tts.estTotalSec = 0;
    tts.chunkIdx = 0;
    tts.chunkStartedAt = 0;
    tts.elapsed = 0;
    if (prevCard) updateCardAudioUI(prevCard);
    updateHeaderAudioIcon();
  }

  function speakNextChunk() {
    if (!("speechSynthesis" in window)) return;
    if (!tts.isPlaying || tts.chunkIdx >= tts.chunks.length) {
      stopSpeech();
      return;
    }
    tts.utterToken += 1;
    const myToken = tts.utterToken;
    const langCode = LANG_MAP[currentLang] || "zh-TW";
    const rate = playbackRates[rateIdx];
    const voice = pickVoice(langCode);
    const startIdx = tts.chunkIdx;
    tts.chunkStartedAt = Date.now();

    // 預先將後續段落依序排入瀏覽器語音佇列，消除段落之間（如「導覽鑑賞重點」前）的長停頓
    for (let i = startIdx; i < tts.chunks.length; i++) {
      const utter = new SpeechSynthesisUtterance(tts.chunks[i]);
      utter.lang = langCode;
      utter.rate = rate;
      if (voice) utter.voice = voice;

      const idx = i;
      utter.onstart = () => {
        if (tts.utterToken !== myToken) return;
        tts.chunkIdx = idx;
        tts.chunkStartedAt = Date.now();
        if (tts.activeCard) updateCardAudioUI(tts.activeCard);
      };
      utter.onend = () => {
        if (tts.utterToken !== myToken) return;
        if (idx === tts.chunks.length - 1) {
          stopSpeech();
        }
      };
      utter.onerror = ev => {
        if (tts.utterToken !== myToken) return;
        if (ev.error === "interrupted" || ev.error === "canceled") return;
        if (idx === tts.chunks.length - 1) {
          stopSpeech();
        }
      };
      window.speechSynthesis.speak(utter);
    }
  }

  function extractCardSpeechText(cardEl) {
    if (!cardEl) return "";
    const parts = [];
    const sep = currentLang === "en" ? " " : "。";

    if (cardEl.classList.contains("deity-card")) {
      // 只取內文（「神祇介紹」與「導覽重點」），不包含標題、副標題與圖片說明
      cardEl.querySelectorAll(".deity-intro-body, .deity-hl-body").forEach(el => {
        const txt = el.textContent.trim();
        if (txt) parts.push(txt);
      });
      if (!parts.length) {
        const fallback = cardEl.querySelector("p.font-body-md");
        if (fallback && fallback.textContent.trim()) parts.push(fallback.textContent.trim());
      }
    } else if (cardEl.classList.contains("arch-card")) {
      // 只取內文摘要、重點說明與深度解析段落，不包含標題、年代標籤與圖片說明
      cardEl.querySelectorAll(".arch-summary, .arch-callout-text, .arch-deep-dive .deep-dive-block p").forEach(el => {
        const txt = el.textContent.trim();
        if (txt) parts.push(txt);
      });
    }

    return prepareSpeechText(parts.join(sep), currentLang);
  }

  function startCardSpeechAt(cardEl, key, initialFrac) {
    if (!("speechSynthesis" in window)) return;
    const targetKey = key || (cardEl && (cardEl.id || cardEl.getAttribute("data-arch-card"))) || "page";

    stopSpeech();
    let text = extractCardSpeechText(cardEl);
    if (!text) {
      const mainEl = document.querySelector("main");
      text = prepareSpeechText(mainEl ? mainEl.innerText.slice(0, 1200) : "", currentLang);
    }
    const chunks = splitSentences(text, currentLang);
    if (!chunks.length) return;

    const starts = [0];
    let total = 0;
    chunks.forEach(c => {
      total += c.length;
      starts.push(total);
    });

    tts.activeKey = targetKey;
    tts.activeCard = cardEl;
    tts.chunks = chunks;
    tts.chunkStarts = starts;
    tts.totalChars = Math.max(1, total);
    tts.estTotalSec = Math.max(10, Math.round(total / charsPerSecond(currentLang)));
    tts.isPlaying = true;
    tts.isPaused = false;

    const frac = typeof initialFrac === "number" ? Math.max(0, Math.min(0.99, initialFrac)) : 0;
    const targetChar = frac * tts.totalChars;
    let idx = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (targetChar >= starts[i] && targetChar < starts[i + 1]) {
        idx = i;
        break;
      }
    }
    tts.chunkIdx = idx;
    tts.elapsed = Math.round(frac * tts.estTotalSec);

    if (cardEl) updateCardAudioUI(cardEl);
    updateHeaderAudioIcon();

    tts.timer = setInterval(() => {
      if (tts.isPlaying && !tts.isPaused && !tts.isScrubbing) {
        if ("speechSynthesis" in window && window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        const f = computeProgressFraction();
        tts.elapsed = Math.round(f * tts.estTotalSec);
        if (tts.activeCard) updateCardAudioUI(tts.activeCard);
      }
    }, 250);

    speakNextChunk();
  }

  function toggleCardSpeech(cardEl, key) {
    if (!("speechSynthesis" in window)) return;
    const targetKey = key || (cardEl && (cardEl.id || cardEl.getAttribute("data-arch-card"))) || "page";

    if (tts.activeKey === targetKey && tts.isPlaying) {
      if (tts.isPaused) {
        tts.isPaused = false;
        tts.chunkStartedAt = Date.now();
        window.speechSynthesis.resume();
        if (!window.speechSynthesis.speaking) speakNextChunk();
      } else {
        tts.isPaused = true;
        window.speechSynthesis.pause();
      }
      if (cardEl) updateCardAudioUI(cardEl);
      updateHeaderAudioIcon();
      return;
    }

    startCardSpeechAt(cardEl, key, 0);
  }

  function seekCardSpeech(cardEl, frac) {
    const safeFrac = Math.max(0, Math.min(0.99, frac));
    if (!tts.isPlaying || tts.activeCard !== cardEl) {
      startCardSpeechAt(cardEl, null, safeFrac);
      return;
    }
    const targetChar = safeFrac * tts.totalChars;
    let idx = 0;
    for (let i = 0; i < tts.chunks.length; i++) {
      if (targetChar >= tts.chunkStarts[i] && targetChar < tts.chunkStarts[i + 1]) {
        idx = i;
        break;
      }
    }
    tts.utterToken += 1;
    tts.chunkIdx = idx;
    tts.chunkStartedAt = Date.now();
    tts.elapsed = Math.round(safeFrac * tts.estTotalSec);
    if (cardEl) updateCardAudioUI(cardEl);

    if (!tts.isPaused) {
      window.speechSynthesis.cancel();
      speakNextChunk();
    } else {
      window.speechSynthesis.cancel();
    }
  }

  function cycleSpeechRate(e) {
    if (e) e.stopPropagation();
    rateIdx = (rateIdx + 1) % playbackRates.length;
    const rateStr = playbackRates[rateIdx] + "x";
    document.querySelectorAll(".tts-speed-badge").forEach(el => {
      el.textContent = rateStr;
    });
    if (tts.isPlaying && !tts.isPaused) {
      tts.utterToken += 1;
      window.speechSynthesis.cancel();
      speakNextChunk();
    }
  }

  function updateCardAudioUI(cardEl) {
    if (!cardEl) return;
    const isThisActive = tts.activeCard === cardEl && tts.isPlaying;
    const isPaused = isThisActive && tts.isPaused;
    const playIcon = cardEl.querySelector(".tts-play-icon");
    const statusSpan = cardEl.querySelector(".tts-status-label");
    const durStr = isThisActive && tts.estTotalSec > 0
      ? formatMMSS(tts.estTotalSec)
      : (cardEl.getAttribute("data-duration") || "02:30");

    if (playIcon) {
      playIcon.textContent = isThisActive && !isPaused ? "pause" : "play_arrow";
    }
    if (statusSpan) {
      if (!isThisActive) {
        statusSpan.textContent = `${i18n("audioTapHint")} (${durStr})`;
      } else if (isPaused) {
        statusSpan.textContent = `${i18n("audioPaused")} (${formatMMSS(tts.elapsed)} / ${durStr})`;
      } else {
        statusSpan.textContent = `${i18n("audioPlaying")} (${formatMMSS(tts.elapsed)} / ${durStr})`;
      }
    }

    // 更新進度條與目前/總時長
    const range = cardEl.querySelector(".tts-seek-range");
    const curEl = cardEl.querySelector(".tts-time-cur");
    const totEl = cardEl.querySelector(".tts-time-tot");
    if (range && !tts.isScrubbing) {
      const frac = isThisActive ? computeProgressFraction() : 0;
      const pct = Math.round(frac * 1000) / 10;
      range.value = Math.round(frac * 1000);
      range.style.background = `linear-gradient(to right, #9e2016 ${pct}%, #e2dcd3 ${pct}%)`;
    }
    if (curEl) {
      curEl.textContent = isThisActive ? formatMMSS(tts.elapsed) : "00:00";
    }
    if (totEl) {
      totEl.textContent = durStr;
    }
  }

  function enhanceAudioPlayers() {
    if (document.getElementById("tts-progress-styles") === null && document.head) {
      const st = document.createElement("style");
      st.id = "tts-progress-styles";
      st.textContent = `
        .tts-seek-range {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 9999px;
          outline: none;
          touch-action: none;
        }
        .tts-seek-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: #9e2016;
          border: 2px solid #ffffff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.28);
          cursor: pointer;
          transition: transform 0.12s ease;
        }
        .tts-seek-range:active::-webkit-slider-thumb {
          transform: scale(1.22);
        }
        .tts-seek-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: #9e2016;
          border: 2px solid #ffffff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.28);
          cursor: pointer;
        }
      `;
      document.head.appendChild(st);
    }

    document.querySelectorAll(".tts-trigger-btn").forEach(btn => {
      const box = btn.closest(".rounded-2xl, .rounded-xl");
      const card = btn.closest(".deity-card, .arch-card");
      if (!box || !card || box.querySelector(".tts-progress-row")) return;

      const durStr = card.getAttribute("data-duration") || "02:30";
      const existingChildren = Array.from(box.children);

      const topRow = document.createElement("div");
      topRow.className = "flex items-center justify-between gap-2 w-full";
      existingChildren.forEach(ch => topRow.appendChild(ch));

      box.classList.remove("items-center", "justify-between");
      box.classList.add("flex-col", "gap-2");
      box.appendChild(topRow);

      const progRow = document.createElement("div");
      progRow.className = "tts-progress-row flex items-center gap-2 w-full pt-0.5";
      progRow.innerHTML = `
        <span class="tts-time-cur font-label-sm text-[11px] tabular-nums text-on-surface-variant w-9 shrink-0">00:00</span>
        <input type="range" min="0" max="1000" value="0" aria-label="語音導覽播放進度" class="tts-seek-range flex-1 cursor-pointer" style="background: linear-gradient(to right, #9e2016 0%, #e2dcd3 0%);" />
        <span class="tts-time-tot font-label-sm text-[11px] tabular-nums text-on-surface-variant w-9 text-right shrink-0">${durStr}</span>
      `;
      box.appendChild(progRow);

      const range = progRow.querySelector(".tts-seek-range");
      const curEl = progRow.querySelector(".tts-time-cur");

      const stopBubble = e => e.stopPropagation();
      ["pointerdown", "mousedown", "touchstart", "click"].forEach(ev => {
        progRow.addEventListener(ev, stopBubble);
      });

      range.addEventListener("input", e => {
        e.stopPropagation();
        tts.isScrubbing = true;
        const frac = Math.max(0, Math.min(1, Number(range.value) / 1000));
        const pct = Math.round(frac * 1000) / 10;
        range.style.background = `linear-gradient(to right, #9e2016 ${pct}%, #e2dcd3 ${pct}%)`;
        if (tts.activeCard === card && tts.estTotalSec > 0 && curEl) {
          curEl.textContent = formatMMSS(Math.round(frac * tts.estTotalSec));
        }
      });

      range.addEventListener("change", e => {
        e.stopPropagation();
        const frac = Math.max(0, Math.min(1, Number(range.value) / 1000));
        tts.isScrubbing = false;
        seekCardSpeech(card, frac);
      });
    });
  }

  function updateHeaderAudioIcon() {
    const btn = document.getElementById("header-audio-btn");
    if (!btn) return;
    const icon = btn.querySelector(".material-symbols-outlined");
    if (!icon) return;
    const active = tts.isPlaying && !tts.isPaused;
    icon.textContent = active ? "volume_up" : "headphones";
    btn.classList.toggle("text-primary", active);
    btn.classList.toggle("bg-primary-fixed", active);
  }

  // =========================================================
  // 四語翻譯套用 (保留 Stitch 原生版面與樣式)
  // =========================================================
  const ARCH_CARD_MAP = {
    hall: {
      code: "HALL",
      badge: { zh: "全台唯一", en: "Sole in Taiwan", ja: "台湾唯一", ko: "대만 유일" },
      era: { zh: "建於西元 1678 年 (明永曆三十二年)", en: "Founded 1678 CE (Ming Yongli 32)", ja: "1678年（明永暦32年）創建", ko: "1678년(명 영력 32년) 창건" },
      callout: {
        zh: "清代每逢仲春、仲秋致祭保生大帝，台廈兵備道及地方文武百官必先至中央官廳「洗塵整冠、更換祭服」，是全台唯一官民一體、佛道互映的歷史典範。",
        en: "Each spring and autumn during the Qing dynasty, civil and military mandarins stopped at the central Official Hall to purify themselves and change into ceremonial robes before offering state sacrifices to Baosheng Dadi.",
        ja: "清代の春秋二季の公式祭祀の際、文武百官はまず中央の官庁で身を清め祭服に着替えました。官民一体・仏道共融を体現する台湾唯一の歴史空間です。",
        ko: "청대 봄가을 보생대제 공식 제례 때마다 문무 백관이 먼저 중앙 관청에 들러 의관을 정제하고 제복으로 갈아입었으며, 관민 일체와 불도 공존을 보여주는 대만 유일의 역사적 공간입니다."
      }
    },
    cabinet: {
      code: "A01",
      badge: { zh: "百年藥籤文化", en: "Centennial Medical Oracles", ja: "百年の薬籤文化", ko: "백년 약첨 문화" },
      era: { zh: "興濟宮珍藏・常民醫療史", en: "Xingji Temple Treasure ‧ Folk Medicine", ja: "興済宮収蔵・庶民医療史", ko: "흥제궁 소장 · 서민 의료사" }
    },
    "pan-paintings": {
      code: "A03",
      code2: "A04",
      badge: { zh: "國寶彩繪大師", en: "National Treasure Painter", ja: "人間国宝の彩絵師", ko: "국보 채화 대사" },
      era: { zh: "興濟宮正殿壁堵・經典神蹟合璧", en: "Xingji Main Hall Murals ‧ Twin Miracles", ja: "興済宮正殿壁画・二大奇跡", ko: "흥제궁 정전 벽화 · 양대 기적" },
      title: {
        zh: "國寶大師潘麗水・泥金神蹟壁畫雙壁",
        en: "Master Pan Lishui ‧ Twin Miracle Murals (Dragon's Eye & Tiger's Throat)",
        ja: "人間国宝・潘麗水「点龍睛・医虎喉」二大奇跡壁画",
        ko: "국보 화사 반려수 · '점룡정·의호후' 양대 신적 벽화"
      },
      cap1: { zh: "A3 點龍睛 (龍邊)", en: "A3 Dotting the Dragon's Eye", ja: "A3 点龍睛（龍側）", ko: "A3 점룡정 (용변)" },
      cap2: { zh: "A4 醫虎喉 (虎邊)", en: "A4 Healing the Tiger's Throat", ja: "A4 医虎喉（虎側）", ko: "A4 의호후 (호변)" }
    },
    stele: {
      code: "A05",
      badge: { zh: "清代金石檔案", en: "Qing Epigraphic Archive", ja: "清代の金石史料", ko: "청대 금석 기록" },
      era: { zh: "連幅古石碑群・重要官署史料", en: "Historic Granite Steles ‧ Official Records", ja: "古石碑群・公式修復記録", ko: "연폭 고석비군 · 관청 사료" }
    },
    molding: {
      code: "A06",
      code2: "A07",
      code3: "A08",
      badge: { zh: "國寶水磨泥塑", en: "Masterpiece Lime Stucco", ja: "国宝級の水磨泥塑", ko: "국보급 수마니소" },
      era: { zh: "灰泥浮雕國寶", en: "High-Relief Lime Stucco", ja: "漆喰高浮彫の至宝", ko: "회소 고부조의 정수" },
      title: {
        zh: "國寶水磨泥塑・龍堵與護法官將壁群",
        en: "Water-Polished Lime Stucco ‧ Dragon Wall & Thirty-Six Generals",
        ja: "水磨泥塑・蒼龍教子龍堵と三十六官将壁堵",
        ko: "수마니소 · 창룡교자 용도와 36관장 벽도"
      }
    },
    arhats: {
      code: "A09",
      code2: "A11",
      badge: { zh: "大觀音亭佛殿", en: "Da Guanyin Pavilion Main Hall", ja: "大観音亭正殿", ko: "대관음정 불전" },
      era: { zh: "咾咕石奇石造景・洞壑山景", en: "Coral Stone Grotto Landscape", ja: "珊瑚岩の立体石窟造形", ko: "산호초석 입체 석굴 조경" },
      title: {
        zh: "十八羅漢天然石窟洞壑・山景奇觀",
        en: "Eighteen Arhats Natural Rock Cave Grottoes",
        ja: "十八羅漢 天然石窟洞壑（龍側・虎側羅漢山）",
        ko: "십팔나한 천연 석굴 동학 (용변·호변 나한산)"
      },
      cap1: { zh: "A9 龍邊羅漢山", en: "A9 Dragon-Side Arhat Grotto", ja: "A9 龍側羅漢山", ko: "A9 용변 나한산" },
      cap2: { zh: "A11 虎邊羅漢山", en: "A11 Tiger-Side Arhat Grotto", ja: "A11 虎側羅漢山", ko: "A11 호변 나한산" }
    },
    oracle: {
      code: "A10",
      badge: { zh: "百年庶民信仰", en: "Centennial Folk Faith", ja: "百年の庶民信仰", ko: "백년 서민 신앙" },
      era: { zh: "溫潤歷史包漿・神驗靈籤", en: "100 Fortune Oracles of Guanyin", ja: "観音百首霊籤（おみくじ）", ko: "관음 백수 영첨" }
    },
    tiles: {
      code: "A12",
      badge: { zh: "窯燒釉彩工藝", en: "Kiln-Fired Glaze Art", ja: "窯焼き絵付けタイル", ko: "가마 소성 채화 타일" },
      era: { zh: "大觀音亭壁堵・松鶴延年", en: "Guanyin Pavilion ‧ Pine & Cranes", ja: "大観音亭・松鶴延年", ko: "대관음정 · 송학연년" }
    }
  };

  function applyLanguageToPage(lang, showToastFlag) {
    if (!LANG_MAP[lang]) lang = "zh";
    const changed = currentLang !== lang;
    currentLang = lang;
    try {
      localStorage.setItem("guanyin_tour_lang", lang);
    } catch (e) { }
    document.documentElement.lang = HTML_LANG[lang] || "zh-TW";

    if (changed && tts.isPlaying) {
      stopSpeech();
    }

    // 1. 更新語言切換按鈕膠囊樣式
    document.querySelectorAll(".lang-btn").forEach(btn => {
      const btnLang = btn.getAttribute("data-lang");
      const active = btnLang === lang;
      if (active) {
        btn.className = "lang-btn px-3 py-1 rounded-full text-label-sm font-label-sm bg-primary text-on-primary font-semibold shadow-sm transition-all";
      } else {
        btn.className = "lang-btn px-2.5 py-1 rounded-full text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all";
      }
    });

    // 顯示 Stitch 語言切換提示 Toast
    if (showToastFlag) {
      const toast = document.getElementById("lang-toast");
      const toastText = document.getElementById("lang-toast-text");
      const toastMsgs = {
        zh: "語言已切換：繁體中文",
        en: "Language switched to English",
        ja: "言語を「日本語」に切り替えました",
        ko: "언어가 한국어로 변경되었습니다"
      };
      if (toast && toastText) {
        toastText.textContent = toastMsgs[lang];
        toast.classList.remove("hidden");
        toast.classList.add("flex");
        clearTimeout(toast._t);
        toast._t = setTimeout(() => {
          toast.classList.add("hidden");
          toast.classList.remove("flex");
        }, 2000);
      }
    }

    // 2. 更新底部 3 個導覽分頁文字
    const navHomeSpan = document.querySelector('nav a[data-path="3d-overview"] span:last-child');
    const navDeitiesSpan = document.querySelector('nav a[data-path="deities-guide"] span:last-child');
    const navArchSpan = document.querySelector('nav a[data-path="monument-architecture"] span:last-child');
    if (navHomeSpan) navHomeSpan.textContent = i18n("navHome");
    if (navDeitiesSpan) navDeitiesSpan.textContent = i18n("navDeities");
    if (navArchSpan) navArchSpan.textContent = i18n("navArch");

    // 3. 更新含有 [data-i18n] 屬性的元素
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const k = el.getAttribute("data-i18n");
      if (k) el.textContent = i18n(k);
    });

    // 4. 針對各頁面更新卡片內容
    const page = document.body.getAttribute("data-page");
    if (page === "home") {
      updateHomePageLang(lang);
    } else if (page === "deities") {
      updateDeitiesPageLang(lang);
    } else if (page === "architecture") {
      updateArchPageLang(lang);
    }
  }

  function updateHomePageLang(lang) {
    const h1 = document.querySelector("header h1");
    const sub = document.querySelector("header p");
    if (h1) h1.textContent = i18n("homeTitle");
    if (sub) sub.textContent = i18n("homeSub");

    // 更新 4 大探索熱點卡片
    const hotspotCards = document.querySelectorAll("[data-hotspot-idx]");
    hotspotCards.forEach(card => {
      const idx = parseInt(card.getAttribute("data-hotspot-idx"), 10);
      const h = window.TOUR_HOTSPOTS && window.TOUR_HOTSPOTS[idx];
      if (!h) return;
      const badgeEl = card.querySelector(".hs-badge");
      const tagEl = card.querySelector(".hs-tag");
      const titleEl = card.querySelector(".hs-title");
      const descEl = card.querySelector(".hs-desc");
      const chip1El = card.querySelector(".hs-chip1");
      const chip2El = card.querySelector(".hs-chip2");
      const ctaEl = card.querySelector(".hs-cta");
      if (badgeEl) badgeEl.textContent = h.badge[lang] || h.badge.zh;
      if (tagEl) tagEl.textContent = h.tag[lang] || h.tag.zh;
      if (titleEl) titleEl.textContent = h.title[lang] || h.title.zh;
      if (descEl) descEl.textContent = h.desc[lang] || h.desc.zh;
      if (chip1El && h.chips[0]) chip1El.textContent = h.chips[0][lang] || h.chips[0].zh;
      if (chip2El && h.chips[1]) chip2El.textContent = h.chips[1][lang] || h.chips[1].zh;
      if (ctaEl) ctaEl.textContent = h.cta[lang] || h.cta.zh;
    });

    // 更新雙廟參拜動線（興濟宮 / 大觀音亭各自 7 步）
    if (window.TOUR_ROUTES) {
      Object.entries(window.TOUR_ROUTES).forEach(([temple, steps]) => {
        steps.forEach((step, idx) => {
          const sel = `[data-route-temple="${temple}"]`;
          const shortEl = document.querySelector(`${sel}[data-route-short="${idx}"]`);
          const subEl = document.querySelector(`${sel}[data-route-sub="${idx}"]`);
          const dTitle = document.querySelector(`${sel}[data-route-dtitle="${idx}"]`);
          const dDesc = document.querySelector(`${sel}[data-route-ddesc="${idx}"]`);
          if (shortEl) shortEl.textContent = step.short[lang] || step.short.zh;
          if (subEl) subEl.textContent = step.sub[lang] || step.sub.zh;
          if (dTitle) dTitle.textContent = step.title[lang] || step.title.zh;
          if (dDesc) dDesc.textContent = step.desc[lang] || step.desc.zh;
        });
      });
    }
    const routeToggleBtn = document.getElementById("route-toggle-btn");
    const routeToggleText = document.getElementById("route-toggle-text");
    if (routeToggleBtn && routeToggleText) {
      const expanded = routeToggleBtn.getAttribute("aria-expanded") === "true";
      routeToggleText.textContent = i18n(expanded ? "routeCollapse" : "routeExpand");
    }
    if (typeof window.refreshRouteMapI18n === "function") {
      window.refreshRouteMapI18n();
    }
  }

  function setTextWithZhCache(el, newText, lang) {
    if (!el) return;
    if (el.dataset.zhOrig === undefined) {
      el.dataset.zhOrig = el.textContent;
    }
    if (lang === "zh") {
      el.textContent = el.dataset.zhOrig;
    } else if (newText !== undefined && newText !== null) {
      el.textContent = newText;
    }
  }

  function updateDeitiesPageLang(lang) {
    const h1 = document.querySelector("header h1");
    const sub = document.querySelector("header p");
    if (h1) h1.textContent = lang === "zh" ? "主祀神明靈驗指南" : i18n("deitiesTitle");
    if (sub) sub.textContent = i18n("deitiesSub");

    // 佛道雙廟切換分頁按鈕
    const btnBud = document.querySelector('#temple-filters [data-target="buddhist"] span:last-child');
    const btnTao = document.querySelector('#temple-filters [data-target="taoist"] span:last-child');
    if (btnBud) btnBud.textContent = i18n("tabBuddhist");
    if (btnTao) btnTao.textContent = i18n("tabTaoist");

    // 返回列表按鈕
    const backBtnSpan = document.querySelector("#detail-back-bar button span:last-child");
    const modeSpan = document.querySelector("#detail-back-bar > span");
    if (backBtnSpan) backBtnSpan.textContent = i18n("backToList");
    if (modeSpan) modeSpan.textContent = i18n("fullTextMode");

    // 更新 13 張神明卡片
    document.querySelectorAll(".deity-card").forEach(card => {
      const primaryCode = card.getAttribute("data-primary-code");
      const item = getItem(primaryCode);
      if (!item) return;

      const h3 = card.querySelector("h3");
      const summaryP = card.querySelector("p.font-body-md");
      const badgeSpan = card.querySelector(".deity-badge-text");
      const introHeading = card.querySelector(".deity-intro-heading");
      const introBody = card.querySelector(".deity-intro-body");
      const hlHeading = card.querySelector(".deity-hl-heading");
      const hlBody = card.querySelector(".deity-hl-body");
      const audioTitle = card.querySelector(".tts-card-title");

      if (primaryCode === "GY-01") {
        // 哼哈二將成對卡片
        const item2 = getItem("GY-02");
        const titles = {
          zh: "山門金剛護法——哼哈二將",
          en: "Mountain Gate Vajra Guardians — Generals Ha & Heng",
          ja: "山門金剛護法 — 哼哈二将（仁王像）",
          ko: "산문 금강 호법 — 흠하양장(금강역사)"
        };
        setTextWithZhCache(h3, titles[lang], lang);
        setTextWithZhCache(badgeSpan, `GY-01 / GY-02 ${item.tags[lang]?.[0] || "Gate Guardians"}`, lang);
        setTextWithZhCache(summaryP, `${item.summary[lang]} ${item2 ? item2.summary[lang] : ""}`, lang);
        setTextWithZhCache(introBody, `${item.intro[lang]}\n\n${item2 ? item2.intro[lang] : ""}`, lang);
        const hls = [...(item.highlights[lang] || []), ...(item2 ? item2.highlights[lang] || [] : [])];
        setTextWithZhCache(hlBody, hls.join(" "), lang);
      } else {
        setTextWithZhCache(h3, item.title[lang] || item.title.zh, lang);
        setTextWithZhCache(badgeSpan, `${item.id} ${item.tags[lang]?.[0] || item.tags.zh[0]}`, lang);
        setTextWithZhCache(summaryP, item.summary[lang] || item.summary.zh, lang);
        setTextWithZhCache(introBody, item.intro[lang] || item.intro.zh, lang);
        setTextWithZhCache(hlBody, (item.highlights[lang] || item.highlights.zh || []).join(" "), lang);
      }

      setTextWithZhCache(introHeading, i18n("deityIntroTitle"), lang);
      setTextWithZhCache(hlHeading, i18n("deityHighlightTitle"), lang);
      setTextWithZhCache(audioTitle, i18n("audioCardTitle"), lang);

      // GY-04 線上求月老紅線按鈕
      if (primaryCode === "GY-04") {
        const redBtnSpan = card.querySelector('button[onclick*="openRedThreadModal"] span:last-child');
        const redLabels = {
          zh: "線上求月老紅線與靈籤",
          en: "Draw Yue Lao's Red Thread & Blessing Lot Online",
          ja: "オンラインで月老の赤い糸とおみくじを引く",
          ko: "온라인 월하노인 붉은 실 및 영첨 뽑기"
        };
        setTextWithZhCache(redBtnSpan, redLabels[lang], lang);
      }

      // XJ-01 百年四大傳統藥籤部面板
      if (primaryCode === "XJ-01") {
        const medGrid = card.querySelector(".grid.grid-cols-4");
        if (medGrid) {
          const panel = medGrid.parentElement;
          const titleSpan = panel.querySelector(".flex.items-center.justify-between > span:first-child");
          const subSpan = panel.querySelector(".flex.items-center.justify-between > span:last-child");
          const medHeader = {
            zh: ["百年四大傳統藥籤部", "清代官祀刻印"],
            en: ["Four Traditional Medical Oracle Divisions", "Qing Imperial Woodblocks"],
            ja: ["百年伝承・四大薬籤部門", "清代官祀刻印"],
            ko: ["백년 전통 4대 약첨부", "청대 관사 각인"]
          };
          if (titleSpan && titleSpan.childNodes.length) {
            const lastNode = titleSpan.childNodes[titleSpan.childNodes.length - 1];
            if (lastNode.nodeType === 3) {
              lastNode.nodeValue = " " + (medHeader[lang] || medHeader.zh)[0];
            }
          }
          setTextWithZhCache(subSpan, (medHeader[lang] || medHeader.zh)[1], lang);
          const deptData = {
            zh: [["內科", "120首"], ["外科", "60首"], ["眼科", "30首"], ["小兒科", "60首"]],
            en: [["Internal", "120 lots"], ["Surgery", "60 lots"], ["Ophthal.", "30 lots"], ["Pediatrics", "60 lots"]],
            ja: [["内科", "120首"], ["外科", "60首"], ["眼科", "30首"], ["小児科", "60首"]],
            ko: [["내과", "120수"], ["외과", "60수"], ["안과", "30수"], ["소아과", "60수"]]
          };
          const cols = medGrid.querySelectorAll(":scope > div");
          cols.forEach((col, idx) => {
            const s1 = col.querySelector("span:first-child");
            const s2 = col.querySelector("span:last-child");
            const pair = (deptData[lang] || deptData.zh)[idx];
            if (pair) {
              setTextWithZhCache(s1, pair[0], lang);
              setTextWithZhCache(s2, pair[1], lang);
            }
          });
        }
      }

      updateCardAudioUI(card);
    });

    // 更新月老紅線彈窗 (#red-thread-modal)
    const modal = document.getElementById("red-thread-modal");
    if (modal) {
      const mTitle = modal.querySelector("h4");
      const mPoem = modal.querySelector(".font-serif.font-bold");
      const mDesc = modal.querySelector("p.font-body-md");
      const mCenser = modal.querySelector(".bg-surface-container-low span:last-child");
      const mCloseBtn = modal.querySelector("button.w-full");
      const modalTexts = {
        zh: {
          t: "月老姻緣神籤",
          p: "「相逢自有千重意，兩情歡欣在目前。」",
          d: "【籤解】所求姻緣契機將至。大觀音亭月老慈悲牽線，宜打開心胸廣結善友，自成佳偶。",
          c: "已為您於雲端香爐順時針繞行三圈",
          b: "妥善珍藏・感恩月老"
        },
        en: {
          t: "Yue Lao Marriage Oracle",
          p: "\"A destined meeting brings boundless affection; mutual joy now unfolds before your eyes.\"",
          d: "[Interpretation] Your auspicious bond is approaching. Yue Lao of Da Guanyin Pavilion blesses your path — open your heart and a wonderful match will blossom.",
          c: "Circled 3 times clockwise over the virtual incense censer for you",
          b: "Keep Blessing & Thank Yue Lao"
        },
        ja: {
          t: "月下老人 良縁おみくじ",
          p: "「相逢うて自ら千重の意あり、両情の歓欣は目前にあり。」",
          d: "【解説】良縁の好機が近づいています。大観音亭の月老が赤い糸を結んでくださいます。心を開いて良き縁を迎えましょう。",
          c: "オンライン香炉で時計回りに3回お清めしました",
          b: "大切に保管・月老に感謝"
        },
        ko: {
          t: "월하노인 인연 신첨",
          p: "「서로 만나 천만뜻이 통하니, 두 마음의 기쁨이 눈앞에 있도다.」",
          d: "【해설】바라던 인연의 기회가 다가오고 있습니다. 대관음정 월하노인께서 자비로이 붉은 실을 이어주시니 마음을 열고 좋은 인연을 맞이하세요.",
          c: "온라인 향로에서 시계방향으로 세 바퀴 돌렸습니다",
          b: "소중히 간직 · 월하노인께 감사"
        }
      };
      const mt = modalTexts[lang] || modalTexts.zh;
      setTextWithZhCache(mTitle, mt.t, lang);
      setTextWithZhCache(mPoem, mt.p, lang);
      setTextWithZhCache(mDesc, mt.d, lang);
      setTextWithZhCache(mCenser, mt.c, lang);
      setTextWithZhCache(mCloseBtn, mt.b, lang);
    }
  }

  function updateArchPageLang(lang) {
    const h1 = document.querySelector("header h1");
    const sub = document.querySelector("header p");
    if (h1) h1.textContent = i18n("archTitle");
    if (sub) sub.textContent = i18n("archSub");

    // 更新返回列表膠囊
    const backSpan = document.querySelector("#backToListBtn span:last-child");
    const modeSpan = document.querySelector("#backToListBar > span");
    if (backSpan) backSpan.textContent = i18n("backToList");
    if (modeSpan) {
      modeSpan.innerHTML = `<span class="material-symbols-outlined text-[14px]">auto_stories</span> ${i18n("fullTextMode")}`;
    }

    // 更新建築卡片
    document.querySelectorAll(".arch-card").forEach(card => {
      const key = card.getAttribute("data-arch-card");
      const cfg = ARCH_CARD_MAP[key];
      if (!cfg) return;
      const item = getItem(cfg.code);
      const item2 = cfg.code2 ? getItem(cfg.code2) : null;
      const item3 = cfg.code3 ? getItem(cfg.code3) : null;
      if (!item) return;

      const badgeEl = card.querySelector(".arch-badge");
      const eraEl = card.querySelector(".arch-era");
      const h3 = card.querySelector("h3");
      const summaryP = card.querySelector(".arch-summary");
      const calloutSpan = card.querySelector(".arch-callout-text");
      const audioTitle = card.querySelector(".tts-card-title");
      const cap1 = card.querySelector(".arch-cap-1");
      const cap2 = card.querySelector(".arch-cap-2");

      if (badgeEl && cfg.badge) setTextWithZhCache(badgeEl, cfg.badge[lang] || cfg.badge.zh, lang);
      if (eraEl && cfg.era) setTextWithZhCache(eraEl, cfg.era[lang] || cfg.era.zh, lang);
      if (h3) {
        setTextWithZhCache(h3, (cfg.title && cfg.title[lang]) || item.title[lang] || item.title.zh, lang);
      }
      if (summaryP) {
        setTextWithZhCache(summaryP, item.summary[lang] || item.summary.zh, lang);
      }
      if (calloutSpan && cfg.callout) {
        setTextWithZhCache(calloutSpan, cfg.callout[lang] || cfg.callout.zh, lang);
      }
      if (audioTitle && h3) {
        setTextWithZhCache(audioTitle, h3.textContent, lang);
      }
      if (cap1 && cfg.cap1) setTextWithZhCache(cap1, cfg.cap1[lang] || cfg.cap1.zh, lang);
      if (cap2 && cfg.cap2) setTextWithZhCache(cap2, cfg.cap2[lang] || cfg.cap2.zh, lang);

      // 更新 .arch-deep-dive 段落
      const deepDive = card.querySelector(".arch-deep-dive");
      if (deepDive) {
        const blocks = deepDive.querySelectorAll(".deep-dive-block");
        if (blocks[0]) {
          const h4 = blocks[0].querySelector("h4");
          const p = blocks[0].querySelector("p");
          setTextWithZhCache(h4, item2 ? (item.title[lang] || item.title.zh) : i18n("archIntroTitle"), lang);
          setTextWithZhCache(p, item.intro[lang] || item.intro.zh, lang);
        }
        if (blocks[1]) {
          const h4 = blocks[1].querySelector("h4");
          const p = blocks[1].querySelector("p");
          if (item2) {
            setTextWithZhCache(h4, item2.title[lang] || item2.title.zh, lang);
            setTextWithZhCache(p, item2.intro[lang] || item2.intro.zh, lang);
          } else {
            setTextWithZhCache(h4, i18n("archHighlightTitle"), lang);
            setTextWithZhCache(p, (item.highlights[lang] || item.highlights.zh || []).join(" "), lang);
          }
        }
        if (blocks[2] && item3) {
          const h4 = blocks[2].querySelector("h4");
          const p = blocks[2].querySelector("p");
          setTextWithZhCache(h4, item3.title[lang] || item3.title.zh, lang);
          setTextWithZhCache(p, item3.intro[lang] || item3.intro.zh, lang);
        }
      }

      updateCardAudioUI(card);
    });

    // 更新匠師工藝對照小辭典
    if (window.TOUR_GLOSSARY) {
      window.TOUR_GLOSSARY.forEach((g, idx) => {
        const tEl = document.querySelector(`[data-glossary-term="${idx}"]`);
        const dEl = document.querySelector(`[data-glossary-desc="${idx}"]`);
        setTextWithZhCache(tEl, g.term[lang] || g.term.zh, lang);
        setTextWithZhCache(dEl, g.desc[lang] || g.desc.zh, lang);
      });
    }
  }

  // =========================================================
  // #Hash 轉跳與點擊卡片專注模式 (Deities & Architecture)
  // =========================================================
  function initDeitiesRouting() {
    const cards = Array.from(document.querySelectorAll(".deity-card"));
    const tabsBar = document.getElementById("temple-tabs-bar");
    const backBar = document.getElementById("detail-back-bar");
    if (!cards.length) return;

    let activeRealm = "buddhist";

    function showDeityList(realm) {
      if (realm) activeRealm = realm;
      stopSpeech();
      if (tabsBar) tabsBar.classList.remove("hidden");
      if (backBar) {
        backBar.classList.add("hidden");
        backBar.classList.remove("flex");
      }

      // 更新佛/道切換按鈕樣式
      document.querySelectorAll("#temple-filters .filter-btn").forEach(btn => {
        const isAct = btn.getAttribute("data-target") === activeRealm;
        btn.className = isAct
          ? "filter-btn flex-1 min-w-[96px] py-2 px-3 rounded-lg bg-surface-container-lowest shadow-sm text-primary-container font-title-md text-title-md flex items-center justify-center gap-1 transition-all"
          : "filter-btn flex-1 min-w-[96px] py-2 px-3 rounded-lg text-on-surface-variant hover:text-on-surface font-body-md text-body-md flex items-center justify-center gap-1 transition-all";
      });

      cards.forEach(card => {
        card.classList.remove("ring-2", "ring-primary", "shadow-2xl");
        const guide = card.querySelector(".full-guide-content");
        if (guide) {
          guide.classList.add("hidden");
          guide.classList.remove("block");
        }
        const r = card.getAttribute("data-realm");
        card.style.display = r === activeRealm ? "flex" : "none";
      });
    }

    function focusDeityCard(targetCard, updateHash) {
      if (!targetCard) return;
      stopSpeech();
      activeRealm = targetCard.getAttribute("data-realm") || activeRealm;

      if (tabsBar) tabsBar.classList.add("hidden");
      if (backBar) {
        backBar.classList.remove("hidden");
        backBar.classList.add("flex");
      }

      cards.forEach(card => {
        const guide = card.querySelector(".full-guide-content");
        if (card === targetCard) {
          card.style.display = "flex";
          card.classList.add("ring-2", "ring-primary", "shadow-2xl");
          if (guide) {
            guide.classList.remove("hidden");
            guide.classList.add("block");
          }
        } else {
          card.style.display = "none";
          card.classList.remove("ring-2", "ring-primary", "shadow-2xl");
          if (guide) {
            guide.classList.add("hidden");
            guide.classList.remove("block");
          }
        }
      });

      if (updateHash) {
        const code = targetCard.getAttribute("data-primary-code");
        if (code) history.replaceState(null, "", "#" + code);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function applyDeitiesHash() {
      const raw = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
      if (!raw) {
        showDeityList(activeRealm);
        return;
      }
      const upper = raw.toUpperCase();
      if (upper === "BUDDHIST" || upper === "GUANYIN") {
        showDeityList("buddhist");
        return;
      }
      if (upper === "TAOIST" || upper === "XINGJI") {
        showDeityList("taoist");
        return;
      }

      // 正規化 GY1 -> GY-01, XJ1 -> XJ-01
      let norm = upper;
      const m = upper.match(/^(GY|XJ)-?0?(\d+)$/);
      if (m) norm = `${m[1]}-${m[2].padStart(2, "0")}`;

      const matchCard = cards.find(c => {
        const codes = (c.getAttribute("data-codes") || "").toUpperCase().split(",");
        return codes.includes(upper) || codes.includes(norm);
      });

      if (matchCard) {
        focusDeityCard(matchCard, false);
      } else {
        showDeityList(activeRealm);
      }
    }

    // 綁定卡片點擊與返回按鈕
    cards.forEach(card => {
      card.onclick = e => {
        if (e.target.closest("button") || e.target.closest("a")) return;
        const isAlreadyFocused = card.classList.contains("ring-2") && backBar && !backBar.classList.contains("hidden");
        if (!isAlreadyFocused) {
          focusDeityCard(card, true);
        }
      };
    });

    const backBtn = backBar ? backBar.querySelector("button") : null;
    if (backBtn) {
      backBtn.onclick = e => {
        e.stopPropagation();
        history.replaceState(null, "", window.location.pathname + window.location.search);
        showDeityList(activeRealm);
      };
    }

    window.filterDeities = function (realm) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      showDeityList(realm);
    };
    window.exitDeityDetailMode = function () {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      showDeityList(activeRealm);
    };

    window.addEventListener("hashchange", applyDeitiesHash);
    applyDeitiesHash();
  }

  function initArchRouting() {
    const cards = Array.from(document.querySelectorAll(".arch-card"));
    const backBar = document.getElementById("backToListBar");
    const backBtn = document.getElementById("backToListBtn");
    const overviewSection = document.getElementById("arch-overview-content");
    const glossarySection = document.getElementById("glossary-section");
    if (!cards.length) return;

    function showArchList() {
      stopSpeech();
      cards.forEach(c => {
        c.classList.remove("focused-card", "hidden");
        const deep = c.querySelector(".arch-deep-dive");
        if (deep) deep.classList.add("hidden");
        const arrow = c.querySelector(".card-arrow");
        if (arrow) arrow.textContent = "arrow_forward";
      });
      if (overviewSection) overviewSection.classList.remove("hidden");
      if (glossarySection) glossarySection.classList.remove("hidden");
      if (backBar) {
        backBar.classList.add("hidden");
        backBar.classList.remove("flex");
      }
    }

    function focusArchCard(targetCard, updateHash) {
      if (!targetCard) return;
      stopSpeech();
      cards.forEach(c => {
        if (c === targetCard) {
          c.classList.add("focused-card");
          c.classList.remove("hidden");
          const deep = c.querySelector(".arch-deep-dive");
          if (deep) deep.classList.remove("hidden");
          const arrow = c.querySelector(".card-arrow");
          if (arrow) arrow.textContent = "expand_less";
        } else {
          c.classList.remove("focused-card");
          c.classList.add("hidden");
        }
      });
      if (overviewSection) overviewSection.classList.add("hidden");
      if (glossarySection) glossarySection.classList.add("hidden");
      if (backBar) {
        backBar.classList.remove("hidden");
        backBar.classList.add("flex");
      }
      if (updateHash) {
        const key = targetCard.getAttribute("data-arch-card");
        if (key) history.replaceState(null, "", "#" + key);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function applyArchHash() {
      const raw = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
      if (!raw) {
        showArchList();
        return;
      }
      const upper = raw.toUpperCase();
      let norm = upper;
      const m = upper.match(/^A-?0?(\d+)$/);
      if (m) norm = "A" + m[1].padStart(2, "0");

      const matchCard = cards.find(c => {
        const key = (c.getAttribute("data-arch-card") || "").toUpperCase();
        const codes = (c.getAttribute("data-arch-codes") || "").toUpperCase().split(",");
        return key === upper || codes.includes(upper) || codes.includes(norm);
      });

      if (matchCard) {
        focusArchCard(matchCard, false);
      } else {
        showArchList();
      }
    }

    cards.forEach(card => {
      card.onclick = e => {
        if (e.target.closest("button") || e.target.closest("a")) return;
        if (card.classList.contains("focused-card")) return;
        focusArchCard(card, true);
      };
    });

    if (backBtn) {
      backBtn.onclick = e => {
        e.stopPropagation();
        history.replaceState(null, "", window.location.pathname + window.location.search);
        showArchList();
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    }

    window.addEventListener("hashchange", applyArchHash);
    applyArchHash();
  }

  // =========================================================
  // 初始化所有事件
  // =========================================================
  function init() {
    currentLang = getInitialLang();

    // 全域語言切換函式相容 Stitch inline onclick
    window.setLang = function (lang, btn) {
      applyLanguageToPage(lang, true);
    };
    window.switchLang = function (btn, lang) {
      applyLanguageToPage(lang, true);
    };
    window.switchLanguage = function (lang, btn) {
      applyLanguageToPage(lang, true);
    };

    document.querySelectorAll(".lang-btn").forEach(btn => {
      btn.onclick = () => {
        const l = btn.getAttribute("data-lang");
        if (l) applyLanguageToPage(l, true);
      };
    });

    // 動態為每張導覽卡片的語音播放器加上進度條與拖曳跳轉功能
    enhanceAudioPlayers();

    // 綁定卡片內語音播放與語速按鈕
    document.querySelectorAll(".tts-trigger-btn").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const card = btn.closest(".deity-card, .arch-card");
        toggleCardSpeech(card);
      };
    });

    document.querySelectorAll(".tts-speed-badge").forEach(btn => {
      btn.onclick = cycleSpeechRate;
    });

    // 綁定頂部耳機按鈕：若目前有聚焦卡片則朗讀該卡片，否則朗讀第一張可見卡片或頁面導覽
    const headerAudioBtn = document.getElementById("header-audio-btn");
    if (headerAudioBtn) {
      headerAudioBtn.onclick = () => {
        if (tts.isPlaying) {
          stopSpeech();
          return;
        }
        const visibleCard = Array.from(document.querySelectorAll(".deity-card, .arch-card")).find(
          c => c.style.display !== "none" && !c.classList.contains("hidden")
        );
        if (visibleCard) {
          toggleCardSpeech(visibleCard);
        } else {
          toggleCardSpeech(null, "home-overview");
        }
      };
    }

    // 綁定頂部分享按鈕
    const shareBtn = document.getElementById("header-share-btn");
    if (shareBtn) {
      shareBtn.onclick = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(window.location.href);
        }
      };
    }

    // 綁定首頁 3D 視窗與 gate.html 互動按鈕
    const gateIframe = document.getElementById("gate-iframe");
    if (gateIframe) {
      const sendGate = msg => {
        if (gateIframe.contentWindow) gateIframe.contentWindow.postMessage(msg, "*");
      };
      const btnSpin = document.getElementById("btn-spin");
      const btnCutaway = document.getElementById("btn-cutaway");
      const btnReset = document.getElementById("btn-reset");
      let isAerial = false;

      if (btnSpin) {
        btnSpin.onclick = () => {
          sendGate({ type: "toggleSpin" });
          btnSpin.classList.toggle("text-primary");
          btnSpin.classList.toggle("bg-primary-fixed");
        };
      }
      if (btnCutaway) {
        btnCutaway.onclick = () => {
          isAerial = !isAerial;
          sendGate({ type: "setCam", cam: isAerial ? "aerial" : "iso" });
          btnCutaway.classList.toggle("text-primary", isAerial);
        };
      }
      if (btnReset) {
        btnReset.onclick = () => {
          isAerial = false;
          sendGate({ type: "reset" });
        };
      }
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
    window.addEventListener("beforeunload", stopSpeech);

    const page = document.body.getAttribute("data-page");
    if (page === "deities") initDeitiesRouting();
    if (page === "architecture") initArchRouting();

    applyLanguageToPage(currentLang, false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
