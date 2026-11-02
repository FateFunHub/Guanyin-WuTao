/**
 * 大觀音亭暨祀典興濟宮 數位寺廟導覽系統 App
 * Da Guanyin Ting & Xingji Temple Digital Guide
 */

// 預設 GitHub Pages 或線上網址（若為本機環境則自動偵測）
const DEFAULT_BASE_URL = window.location.protocol.startsWith('http') 
  ? window.location.origin + window.location.pathname.replace(/\/$/, '')
  : 'https://fatefunhub.github.io/Guanyin-WuTao';

// QR Code 預設展點列表
const QR_PRESETS = {
  home: {
    title: '【大觀音亭暨祀典興濟宮】全館總導覽',
    url: `${DEFAULT_BASE_URL}/#home`,
    desc: '掃描即可開啟全館多功能導覽、官廳古蹟、建築巡禮、觀音與保生大帝神明專區與語音解說。'
  },
  guanting: {
    title: '【全臺唯一】中介「官廳」導覽牌',
    url: `${DEFAULT_BASE_URL}/#arch-guanting`,
    desc: '清代官方祀典文武官員更衣、齋宿與休憩之珍貴歷史建築。'
  },
  baosheng: {
    title: '【祀典興濟宮】保生大帝 (大道公) 專屬導覽牌',
    url: `${DEFAULT_BASE_URL}/#deity-baosheng`,
    desc: '醫神吳真人聖德、全臺唯一祀典保生大帝廟、百年藥籤與安康祈福指南。'
  },
  guanyin: {
    title: '【大觀音亭】觀音佛祖 專屬導覽牌',
    url: `${DEFAULT_BASE_URL}/#deity-guanyin`,
    desc: '明鄭永曆三十二年開基觀音古剎、淨瓶甘露洗滌塵思、修心安寧指南。'
  },
  yuelao: {
    title: '【大觀音亭】府城名聞「闊嘴月老」專屬導覽牌',
    url: `${DEFAULT_BASE_URL}/#deity-yuelao`,
    desc: '嘴闊善媒牽良緣、側耳傾聽單身祈願，府城四大月老牽紅線首選。'
  },
  huye: {
    title: '【祀典興濟宮】超人氣愛吃炸雞虎爺 專屬導覽牌',
    url: `${DEFAULT_BASE_URL}/#deity-huye`,
    desc: '神案下造型古錐之黑虎大將軍，喜食炸雞、招財咬錢水、除煞護幼。'
  },
  route: {
    title: '【雙廟參拜動線】全廟動線指引牌',
    url: `${DEFAULT_BASE_URL}/#route`,
    desc: '敬天、拜大道公、訪虎爺、朝拜觀音佛祖、祈求月老良緣之完整動線。'
  },
  divination: {
    title: '【保生藥籤祈願】線上靈籤祈福牌',
    url: `${DEFAULT_BASE_URL}/#divination`,
    desc: '線上擲筊求籤，承襲大道公醫道妙法與觀音慈航甘露啟發。'
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

  generateQRCode(url, `【專屬導覽牌】${customTitle}`, `手機掃描現場直達「${customTitle}」詳盡解說與語音導覽。`);
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
  utterance.rate = 0.95; // 沉穩典雅的廟宇解說語速
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
   4. 保生藥籤與線上靈籤祈願 (Virtual Omikuji)
   ========================================================================== */
const POEMS = [
  {
    grade: '上上大吉 ‧ 妙手回春',
    poem: '春風化雨百花開，妙手回春福自來。\n觀音灑潤清涼露，大道醫神百病排。',
    explain: '大吉之兆。身心康寧，過去的病痛與煩擾即將消解，精神煥發。保持作息規律與善念，事業與健康皆得貴人相助，百福駢臻。'
  },
  {
    grade: '上吉籤 ‧ 良緣天定',
    poem: '月下老人牽絳繩，闊嘴言媒萬事成。\n莫道姻緣千里遠，眼前便是好前程。',
    explain: '良緣將至之象。闊嘴月老正在為您穿針引線，若是單身者切莫焦急，敞開心胸多參與交流；有伴侶者則感情日益融洽，相知相惜。'
  },
  {
    grade: '中吉籤 ‧ 順應自然',
    poem: '歧黃妙術本通神，調養心神自得真。\n不急不躁行安步，逢凶化吉見陽春。',
    explain: '漸入佳境之象。身體或事業的調養需要耐心與節奏，切忌盲目急進。聽從良醫建議、適度運動休息，自然氣血順暢、時來運轉。'
  },
  {
    grade: '平安籤 ‧ 虎爺招祥',
    poem: '虎嘯生風煞氣消，神威守案降群妖。\n金銀錢水隨身轉，護佑童安福滿橋。',
    explain: '驅邪辟煞之籤。下壇虎爺將軍神威庇佑，小人退避，凶煞不侵。特別護佑家中小孩平安健康成長，財氣隨行、進退平安。'
  }
];

function initDivination() {
  const drawBtn = document.getElementById('btn-draw-fortune');
  const cyl = document.getElementById('divination-cyl');
  const resultCard = document.getElementById('fortune-result-card');

  if (drawBtn && cyl) {
    drawBtn.addEventListener('click', () => {
      drawBtn.disabled = true;
      drawBtn.textContent = '誠心向保生大帝與觀音佛祖擲筊求籤中...';
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
