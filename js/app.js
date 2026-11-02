/**
 * 觀音武道 數位寺廟導覽系統 Guanyin-WuTao Temple Guide App
 */

// 預設 GitHub Pages 或線上網址（若為本機環境則自動偵測）
const DEFAULT_BASE_URL = window.location.protocol.startsWith('http') 
  ? window.location.origin + window.location.pathname.replace(/\/$/, '')
  : 'https://fatefunhub.github.io/Guanyin-WuTao';

// QR Code 預設展點列表
const QR_PRESETS = {
  home: {
    title: '【觀音武道】全館總導覽',
    url: `${DEFAULT_BASE_URL}/#home`,
    desc: '掃描即可開啟全館多功能導覽、建築巡禮、神明專區與語音導覽服務。'
  },
  architecture: {
    title: '【建築特色】古蹟工藝巡禮',
    url: `${DEFAULT_BASE_URL}/#architecture`,
    desc: '介紹三川殿、燕尾脊、八角藻井、青斗石雕龍柱與交趾陶工藝。'
  },
  deities: {
    title: '【供奉神明】諸神神聖列陣',
    url: `${DEFAULT_BASE_URL}/#deities`,
    desc: '認識主祀觀世音菩薩、武聖關聖帝君、媽祖、文昌帝君、註生娘娘及虎爺。'
  },
  guanyin: {
    title: '【主殿】觀世音菩薩 專屬導覽牌',
    url: `${DEFAULT_BASE_URL}/#deity-guanyin`,
    desc: '大慈大悲觀世音菩薩職司、淨瓶甘露寓意與虔心祈安指南。'
  },
  guandi: {
    title: '【武聖殿】關聖帝君 專屬導覽牌',
    url: `${DEFAULT_BASE_URL}/#deity-guandi`,
    desc: '忠義千秋武聖關公、青龍偃月刀威儀與事業開運參拜禮儀。'
  },
  route: {
    title: '【參拜動線】全廟動線指引',
    url: `${DEFAULT_BASE_URL}/#route`,
    desc: '遵循傳統由天公爐至正殿、偏殿及虎爺的完整五步參拜心法。'
  },
  divination: {
    title: '【心靈解惑】線上靈籤祈福',
    url: `${DEFAULT_BASE_URL}/#divination`,
    desc: '線上抽籤擲筊、觀音靈籤與關帝靈籤指點迷津。'
  }
};

let currentQRCodeInstance = null;
let currentPlayingBtn = null;
let synth = window.speechSynthesis;

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initQRHub();
  initSpeechGuide();
  initDivination();
});

/* ==========================================================================
   1. 導覽列與平滑捲動
   ========================================================================== */
function initNavbar() {
  const toggleBtn = document.getElementById('nav-toggle-btn');
  const navMenu = document.getElementById('nav-menu');
  const navLinks = document.querySelectorAll('.nav-link');

  if (toggleBtn && navMenu) {
    toggleBtn.addEventListener('click', () => {
      navMenu.classList.toggle('show');
    });
  }

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (navMenu) navMenu.classList.remove('show');
    });
  });

  // 監聽滾動以切換 Active 狀態
  window.addEventListener('scroll', () => {
    const fromTop = window.scrollY + 100;
    navLinks.forEach(link => {
      const section = document.querySelector(link.hash);
      if (
        section &&
        section.offsetTop <= fromTop &&
        section.offsetTop + section.offsetHeight > fromTop
      ) {
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  });
}

/* ==========================================================================
   2. QR Code 生成與管理中心
   ========================================================================== */
function initQRHub() {
  const tabs = document.querySelectorAll('.qr-tab-btn');
  const customUrlInput = document.getElementById('custom-url-input');
  const btnApplyCustom = document.getElementById('btn-apply-custom');

  // 切換預設分籤
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const presetKey = tab.dataset.preset;
      if (QR_PRESETS[presetKey]) {
        generateQRCode(QR_PRESETS[presetKey].url, QR_PRESETS[presetKey].title, QR_PRESETS[presetKey].desc);
      }
    });
  });

  // 自訂網址輸入生成
  if (btnApplyCustom && customUrlInput) {
    btnApplyCustom.addEventListener('click', () => {
      const customUrl = customUrlInput.value.trim();
      if (!customUrl) {
        alert('請輸入有效的網址或導覽頁面錨點連結！');
        return;
      }
      tabs.forEach(t => t.classList.remove('active'));
      generateQRCode(customUrl, '自訂導覽牌 QR Code', `目前指向自訂連結：${customUrl}`);
    });
  }

  // 預設生成總導覽 QR Code
  generateQRCode(QR_PRESETS.home.url, QR_PRESETS.home.title, QR_PRESETS.home.desc);
}

/**
 * 動態渲染 QR Code
 */
function generateQRCode(url, title, desc) {
  const qrBox = document.getElementById('qrcode-canvas-box');
  const qrTitle = document.getElementById('qr-info-title');
  const qrUrlText = document.getElementById('qr-info-url');
  const qrDesc = document.getElementById('qr-info-desc');
  const printTitle = document.getElementById('print-card-title');
  const printDesc = document.getElementById('print-card-desc');

  if (!qrBox) return;

  // 清空舊 QR Code
  qrBox.innerHTML = '';

  // 檢查 QRCode.js 是否已載入
  if (typeof QRCode !== 'undefined') {
    currentQRCodeInstance = new QRCode(qrBox, {
      text: url,
      width: 200,
      height: 200,
      colorDark: '#6e1515',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    // 降級處理：使用可靠的公共 API 圖片載入
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    img.alt = 'QR Code';
    qrBox.appendChild(img);
  }

  // 更新介面文案
  if (qrTitle) qrTitle.textContent = title;
  if (qrUrlText) qrUrlText.textContent = url;
  if (qrDesc) qrDesc.textContent = desc;
  if (printTitle) printTitle.textContent = title;
  if (printDesc) printDesc.textContent = desc;
}

/**
 * 從展品卡片快速跳轉至 QR Code 生成區
 */
function generateCardQR(presetKey, targetHash, customTitle) {
  const qrSection = document.getElementById('qrcode');
  if (qrSection) {
    qrSection.scrollIntoView({ behavior: 'smooth' });
  }

  const url = `${DEFAULT_BASE_URL}/${targetHash}`;
  const tabs = document.querySelectorAll('.qr-tab-btn');
  tabs.forEach(t => {
    if (t.dataset.preset === presetKey) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  generateQRCode(url, `【專屬導覽牌】${customTitle}`, `掃描現場手機直達「${customTitle}」詳盡解說與語音導覽。`);
}

/**
 * 複製當前 QR Code 連結
 */
function copyQRUrl() {
  const qrUrlText = document.getElementById('qr-info-url');
  if (!qrUrlText) return;

  navigator.clipboard.writeText(qrUrlText.textContent).then(() => {
    alert('已成功複製導覽連結至剪貼簿！');
  }).catch(() => {
    alert('複製失敗，請手動複製連結：' + qrUrlText.textContent);
  });
}

/**
 * 下載 QR Code 圖片
 */
function downloadQRCode() {
  const qrBox = document.getElementById('qrcode-canvas-box');
  const qrTitle = document.getElementById('qr-info-title');
  const title = (qrTitle ? qrTitle.textContent : 'QRCode').replace(/[^\w\u4e00-\u9fa5]/g, '_');

  const img = qrBox.querySelector('img');
  const canvas = qrBox.querySelector('canvas');

  let dataUrl = '';
  if (canvas) {
    dataUrl = canvas.toDataURL('image/png');
  } else if (img && img.src.startsWith('data:')) {
    dataUrl = img.src;
  } else if (img) {
    dataUrl = img.src;
  }

  if (dataUrl) {
    const link = document.createElement('a');
    link.download = `${title}.png`;
    link.href = dataUrl;
    link.click();
  } else {
    alert('QR Code 產生中，請稍候再試。');
  }
}

/**
 * 列印現場導覽牌 / 立牌
 */
function printQRCard() {
  // 準備將目前產生的 QR Code 同步到列印專用區塊
  const srcBox = document.getElementById('qrcode-canvas-box');
  const destBox = document.getElementById('print-qr-target');

  if (srcBox && destBox) {
    destBox.innerHTML = srcBox.innerHTML;
  }

  window.print();
}

/* ==========================================================================
   3. 真人語音導覽 (Speech Synthesis API)
   ========================================================================== */
function initSpeechGuide() {
  if (!('speechSynthesis' in window)) {
    console.warn('此瀏覽器不支援 SpeechSynthesis 語音合成');
  }
}

/**
 * 播放或暫停指定文字的中文語音導覽
 */
function toggleSpeech(btn, textToRead) {
  if (!synth) {
    alert('抱歉，您的瀏覽器目前不支援即時語音導覽功能。');
    return;
  }

  if (synth.speaking) {
    synth.cancel();
    if (currentPlayingBtn === btn) {
      btn.classList.remove('active-play');
      btn.innerHTML = '<span>🔊</span> 語音導覽';
      currentPlayingBtn = null;
      return;
    }
    if (currentPlayingBtn) {
      currentPlayingBtn.classList.remove('active-play');
      currentPlayingBtn.innerHTML = '<span>🔊</span> 語音導覽';
    }
  }

  const utterance = new SpeechSynthesisUtterance(textToRead);
  utterance.lang = 'zh-TW';
  utterance.rate = 0.95; // 稍微沉穩典雅的廟宇解說語速
  utterance.pitch = 1.0;

  utterance.onend = () => {
    btn.classList.remove('active-play');
    btn.innerHTML = '<span>🔊</span> 語音導覽';
    currentPlayingBtn = null;
  };

  utterance.onerror = () => {
    btn.classList.remove('active-play');
    btn.innerHTML = '<span>🔊</span> 語音導覽';
    currentPlayingBtn = null;
  };

  synth.speak(utterance);
  btn.classList.add('active-play');
  btn.innerHTML = '<span>⏸️</span> 暫停朗讀';
  currentPlayingBtn = btn;
}

/* ==========================================================================
   4. 線上求籤祈福互動 (Virtual Omikuji)
   ========================================================================== */
const POEMS = [
  {
    grade: '上上大吉',
    poem: '春風得意馬蹄疾，一日看盡長安花。\n觀音灑甘露，武聖賜福祥。',
    explain: '大吉之兆。目前所求之事如春風化雨，貴人相助，功名利祿皆稱心如意。唯需心存善念，常行布施，福澤更長。'
  },
  {
    grade: '上吉籤',
    poem: '雲開月出正分明，不須進退問前程。\n婚姻皆由天注定，事業財源日日興。',
    explain: '撥雲見日之象。歷經一番耕耘，如今正是撥開迷霧迎接光明之際，宜堅守本分，穩健推進，必有豐碩收穫。'
  },
  {
    grade: '中吉籤',
    poem: '長江風浪漸漸靜，于今得進可安寧。\n必有貴人相扶助，百事吉祥得稱心。',
    explain: '漸入佳境之象。過往的波折正逐漸平息，保持耐心與信心，近期將有良師益友或貴人指引迷津，平安順遂。'
  },
  {
    grade: '平和籤',
    poem: '修心養性待時機，急躁難成大事業。\n靜聽慈航法雨潤，心安茅屋亦生輝。',
    explain: '蓄勢待發之籤。當前宜充實自我、韜光養晦，不宜盲目躁進。修心積德，待時機成熟，自然水到渠成。'
  }
];

function initDivination() {
  const drawBtn = document.getElementById('btn-draw-fortune');
  const cyl = document.getElementById('divination-cyl');
  const resultCard = document.getElementById('fortune-result-card');

  if (drawBtn && cyl) {
    drawBtn.addEventListener('click', () => {
      drawBtn.disabled = true;
      drawBtn.textContent = '誠心向觀音武聖擲筊求籤中...';
      cyl.classList.add('shake');
      if (resultCard) resultCard.style.display = 'none';

      setTimeout(() => {
        cyl.classList.remove('shake');
        const randomPoem = POEMS[Math.floor(Math.random() * POEMS.length)];
        
        document.getElementById('fortune-grade').textContent = randomPoem.grade;
        document.getElementById('fortune-poem-text').innerText = randomPoem.poem;
        document.getElementById('fortune-explain-text').textContent = randomPoem.explain;
        
        if (resultCard) {
          resultCard.style.display = 'block';
          resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        drawBtn.disabled = false;
        drawBtn.textContent = '再次虔誠祈願求籤';
      }, 1500);
    });
  }
}
