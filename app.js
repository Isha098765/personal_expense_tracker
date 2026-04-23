/* ===========================
   FinTrack India — app.js
   Backend-connected version
   API Base: /api
   =========================== */
'use strict';

// ===== CONFIG =====
const API = '/api';

// ===== STATE =====
let transactions = [];   // loaded from server
let currentType = 'expense';
let currentRegime = 'new';
let charts = {};
let currentUser = null;

// ===== OFFLINE QUEUE STATE =====
const QUEUE_KEY = 'fintrack_offline_queue';
let isOnline = navigator.onLine;

// ===== UTILITIES =====
const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDec = (n, d = 2) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const CATEGORY_ICONS = {
  'Food & Dining': '🍕', 'Transport': '🚗', 'Shopping': '🛍️',
  'Entertainment': '🎬', 'Health': '💊', 'Education': '📚',
  'Utilities': '💡', 'Rent': '🏠', 'Salary': '💼',
  'Freelance': '💻', 'Investment': '📈', 'Other': '📦'
};

// ===== API HELPERS =====
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options
    });
    const data = await res.json();
    // Check for offline placeholder from Service Worker
    if (data && data.offline) throw Object.assign(new Error('offline'), { offline: true });
    if (res.status === 401) {
      window.location.href = '/auth';
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Server error');
    return data;
  } catch (err) {
    if (!err.offline) showToast(err.message || 'Network error', 'error');
    throw err;
  }
}

async function loadTransactions() {
  try {
    transactions = await apiFetch('/transactions');
    renderTransactions();
    updateDashboard();
    renderSmartInsightsStrip();
  } catch (_) { }
}

// ===== NAVIGATION =====
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    const titles = {
      dashboard: 'Dashboard', expenses: 'Expense Tracker',
      prediction: 'Expense Prediction', tax: 'Tax Calculator',
      investment: 'Investment Forecasting', insights: 'Smart Insights',
      subscriptions: 'Subscriptions'
    };
    document.getElementById('page-title').textContent = titles[tab] || tab;
    if (tab === 'dashboard') updateDashboard();
    if (tab === 'prediction') updateInsights();
    if (tab === 'insights') updateSmartInsights();
    if (tab === 'subscriptions') loadSubscriptions();
    document.getElementById('sidebar').classList.remove('open');
  });
});

document.getElementById('menu-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ===== DATE HEADER =====
(function setDateHeader() {
  const now = new Date();
  document.getElementById('page-date').textContent =
    now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
})();

// ===== EXPENSE FORM =====
document.getElementById('exp-date').valueAsDate = new Date();

document.getElementById('type-expense').addEventListener('click', () => {
  currentType = 'expense';
  document.getElementById('type-expense').classList.add('active');
  document.getElementById('type-income').classList.remove('active');
});
document.getElementById('type-income').addEventListener('click', () => {
  currentType = 'income';
  document.getElementById('type-income').classList.add('active');
  document.getElementById('type-expense').classList.remove('active');
});

// ===== AUTO-CATEGORIZATION ENGINE =====

/**
 * Client-side pattern rules for common Indian apps & contexts.
 * Ordered by priority (first match wins). These run instantly, zero-latency.
 */
const AC_PATTERNS = [
  // Known Indian food platforms
  { re: /swiggy|zomato|dunzo|blinkit|zepto|bigbasket|grofers|jiomart/i,                   cat: 'Food & Dining',  label: '🍕 Swiggy/Zomato', source: 'rules' },
  { re: /domino|pizza|burger|kfc|mcdonald|subway|haldiram|restaurant|cafe|dhaba/i,         cat: 'Food & Dining',  label: '🍕 Food & Dining', source: 'rules' },
  { re: /grocery|vegetable|sabzi|fruit|mandi|ration|amul/i,                                cat: 'Food & Dining',  label: '🛒 Grocery',       source: 'rules' },
  { re: /biryani|idli|dosa|chai|coffee|lunch|dinner|breakfast|meal|tea/i,                  cat: 'Food & Dining',  label: '🍽️ Meal',          source: 'rules' },
  // Transport
  { re: /uber|ola|rapido|namma|indrive/i,                                                  cat: 'Transport',      label: '🚕 Cab ride',      source: 'rules' },
  { re: /irctc|railway|metro|dtc|bmtc|ksrtc|gsrtc|best bus/i,                             cat: 'Transport',      label: '🚆 Public transit', source: 'rules' },
  { re: /petrol|diesel|cng|fuel|pump/i,                                                    cat: 'Transport',      label: '⛽ Fuel',           source: 'rules' },
  { re: /fastag|toll|parking/i,                                                            cat: 'Transport',      label: '🛣️ Toll/Parking',  source: 'rules' },
  { re: /indigo|spicejet|air india|vistara|flight|airways/i,                               cat: 'Transport',      label: '✈️ Flight',         source: 'rules' },
  { re: /travel|train|bus|ticket/i,                                                        cat: 'Transport',      label: '🎫 Travel',         source: 'rules' },
  // Shopping
  { re: /amazon|flipkart|meesho|myntra|ajio|nykaa|shopsy|snapdeal|tata cliq/i,            cat: 'Shopping',       label: '🛍️ E-commerce',    source: 'rules' },
  { re: /dmart|reliance|croma|decathlon|ikea|mall|market/i,                               cat: 'Shopping',       label: '🏪 Retail',         source: 'rules' },
  { re: /clothes|shoes|kurta|saree|shirt|jeans|dress|bag|watch|jewel/i,                   cat: 'Shopping',       label: '👗 Fashion',         source: 'rules' },
  { re: /mobile|laptop|headphone|gadget|electronics/i,                                    cat: 'Shopping',       label: '📱 Electronics',    source: 'rules' },
  // Entertainment
  { re: /netflix|hotstar|disney|prime video|zee5|sonyliv|jio cinema/i,                    cat: 'Entertainment',  label: '🎬 OTT',            source: 'rules' },
  { re: /spotify|gaana|jio saavn|apple music/i,                                           cat: 'Entertainment',  label: '🎵 Music',           source: 'rules' },
  { re: /bookmyshow|pvr|inox|cinepolis|multiplex/i,                                       cat: 'Entertainment',  label: '🎟️ Cinema',          source: 'rules' },
  { re: /game|gaming|steam|playstation|xbox/i,                                            cat: 'Entertainment',  label: '🎮 Gaming',          source: 'rules' },
  { re: /concert|event|party|club|pub|bar/i,                                              cat: 'Entertainment',  label: '🎉 Events',          source: 'rules' },
  // Health
  { re: /apollo|medplus|netmeds|pharmeasy|1mg|practo|healthkart|medlife/i,                cat: 'Health',         label: '💊 Pharmacy',       source: 'rules' },
  { re: /hospital|clinic|doctor|medical|diagnostic|blood test|xray|mri|scan/i,            cat: 'Health',         label: '🏥 Medical',         source: 'rules' },
  { re: /medicine|pharmacy|tablet|capsule|syrup/i,                                        cat: 'Health',         label: '💊 Medicine',        source: 'rules' },
  { re: /gym|yoga|fitness|workout|zumba|cult fit/i,                                       cat: 'Health',         label: '🏋️ Fitness',         source: 'rules' },
  // Education
  { re: /byju|unacademy|vedantu|toppr|doubtnut|coursera|udemy|upgrad/i,                   cat: 'Education',      label: '📚 Ed-tech',        source: 'rules' },
  { re: /school|college|university|tuition|coaching|admit|admission/i,                    cat: 'Education',      label: '🏫 School/College', source: 'rules' },
  { re: /books|stationery|notebook|library/i,                                             cat: 'Education',      label: '📖 Books',           source: 'rules' },
  // Utilities
  { re: /jio recharge|airtel|bsnl|vi recharge|vodafone|postpaid|prepaid/i,                cat: 'Utilities',      label: '📱 Mobile bill',    source: 'rules' },
  { re: /electricity|bses|bescom|msedcl|tneb|tpddl|wbsedcl|bijli/i,                      cat: 'Utilities',      label: '💡 Electricity',    source: 'rules' },
  { re: /broadband|wifi|internet|dth|tata sky|dish tv|sun direct/i,                       cat: 'Utilities',      label: '🌐 Internet/DTH',   source: 'rules' },
  { re: /lpg|indane|bharat gas|cooking gas|gas cylinder/i,                                cat: 'Utilities',      label: '🔥 Gas',             source: 'rules' },
  { re: /water bill|utility|maintenance charge/i,                                         cat: 'Utilities',      label: '💧 Utilities',       source: 'rules' },
  // Rent
  { re: /rent|pg |paying guest|hostel|house rent|flat rent|apartment/i,                   cat: 'Rent',           label: '🏠 Rent/Housing',   source: 'rules' },
  { re: /society|maintenance|nobroker|magicbricks|99acres/i,                              cat: 'Rent',           label: '🏘️ Housing',          source: 'rules' },
  // Investment
  { re: /zerodha|groww|kuvera|etmoney|smallcase|mutual fund|mf |sip /i,                   cat: 'Investment',     label: '📈 Mutual Fund',    source: 'rules' },
  { re: /ppf|epf|provident fund|nps contribution|gold bond|sgb/i,                        cat: 'Investment',     label: '🏦 Provident Fund', source: 'rules' },
  { re: /fixed deposit|fd |recurring deposit|rd |term deposit/i,                          cat: 'Investment',     label: '🏛️ Fixed Deposit',  source: 'rules' },
  // Salary / Income signals
  { re: /salary credited|salary received|ctc|payroll|pay slip/i,                          cat: 'Salary',         label: '💼 Salary',         source: 'rules' },
  { re: /bonus|incentive|hike|increment/i,                                                cat: 'Salary',         label: '🎁 Bonus',           source: 'rules' },
  { re: /freelance|consulting fee|client payment|invoice paid|project payment/i,          cat: 'Freelance',      label: '💻 Freelance',       source: 'rules' },
];

// UPI/payment app prefix patterns — detected first, then context around them
const UPI_PREFIXES = /^(upi|paytm|gpay|phonepe|bhim|neft|imps|rtgs|banktransfer)[-\s:]*/i;

/** Instant client-side suggestion (no network call). */
function acClientSuggest(desc) {
  if (!desc || desc.length < 3) return null;
  // Strip common UPI prefixes to get the merchant name
  const cleaned = desc.replace(UPI_PREFIXES, '').trim();
  for (const rule of AC_PATTERNS) {
    if (rule.re.test(desc) || rule.re.test(cleaned)) {
      return { category: rule.cat, label: rule.label, source: 'rules' };
    }
  }
  return null;
}

// State for auto-categorization
let acLastSuggested   = null;  // { category, source } of last server/client suggestion
let acUserAccepted    = false; // true if user clicked "Apply"
let acDebounceTimer   = null;
let acAbortController = null;

function acShowSuggestion(category, label, source) {
  acLastSuggested = { category, source };
  const pill    = document.getElementById('ac-pill');
  const srcEl   = document.getElementById('ac-source');
  const wrapper = document.getElementById('ac-suggestion');
  const icons   = { rules: '🇮🇳 Known app', learned: '📚 Learned from you', null: '✨ Suggested' };
  pill.textContent  = label || category;
  srcEl.textContent = icons[source] || '✨ AI';
  wrapper.style.display = 'flex';
  // Animate in
  wrapper.style.opacity = '0';
  requestAnimationFrame(() => { wrapper.style.opacity = '1'; });
}

function acHideSuggestion() {
  document.getElementById('ac-suggestion').style.display = 'none';
  document.getElementById('cat-ai-badge').style.display  = 'none';
  acLastSuggested = null;
  acUserAccepted  = false;
}

function acApplySuggestion(category) {
  document.getElementById('exp-category').value = category;
  document.getElementById('cat-ai-badge').style.display = 'inline-flex';
  document.getElementById('ac-suggestion').style.display = 'none';
  acUserAccepted = true;
}

// Wire up Accept / Dismiss buttons
document.getElementById('ac-accept').addEventListener('click', () => {
  if (acLastSuggested) acApplySuggestion(acLastSuggested.category);
});
document.getElementById('ac-dismiss').addEventListener('click', () => {
  acHideSuggestion();
});

// Remove AI badge when user manually changes category
document.getElementById('exp-category').addEventListener('change', () => {
  document.getElementById('cat-ai-badge').style.display = 'none';
  acUserAccepted = false;
});

/** Debounced handler — fires after user stops typing for 350ms */
async function acOnDescInput(desc) {
  if (desc.length < 3) { acHideSuggestion(); return; }

  // 1. Try instant client-side match first
  const instant = acClientSuggest(desc);
  if (instant) {
    acShowSuggestion(instant.category, instant.label, instant.source);
    return; // no need to hit the server for this
  }

  // 2. Query server (checks user-learned rules)
  document.getElementById('ac-spinner').classList.add('active');
  if (acAbortController) acAbortController.abort();
  acAbortController = new AbortController();
  try {
    const res = await fetch(`${API}/categorize?desc=${encodeURIComponent(desc)}`, {
      credentials: 'same-origin',
      signal: acAbortController.signal
    });
    const data = await res.json();
    if (data.category) {
      acShowSuggestion(data.category, data.category, data.source);
    } else {
      acHideSuggestion();
    }
  } catch (err) {
    if (err.name !== 'AbortError') acHideSuggestion();
  } finally {
    document.getElementById('ac-spinner').classList.remove('active');
  }
}

// Attach debounced listener to description input
document.getElementById('exp-desc').addEventListener('input', (e) => {
  const desc = e.target.value.trim();
  clearTimeout(acDebounceTimer);
  // Reset suggestion state when input changes
  document.getElementById('cat-ai-badge').style.display = 'none';
  acUserAccepted = false;
  if (desc.length < 3) { acHideSuggestion(); return; }
  // Show instant suggestion immediately, then check server after 350ms
  const instant = acClientSuggest(desc);
  if (instant) acShowSuggestion(instant.category, instant.label, instant.source);
  acDebounceTimer = setTimeout(() => acOnDescInput(desc), 350);
});


document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const desc = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const category = document.getElementById('exp-category').value;
  const date = document.getElementById('exp-date').value;

  if (!desc || !amount || !date) { showToast('Please fill all fields', 'error'); return; }
  if (amount <= 0) { showToast('Amount must be positive', 'error'); return; }

  const btn = document.querySelector('#expense-form .btn-primary');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const tx = await apiFetch('/transactions', {
      method: 'POST',
      body: JSON.stringify({ desc, amount, category, date, type: currentType })
    });
    transactions.unshift(tx);
    renderTransactions();
    updateDashboard();
    renderSmartInsightsStrip();

    // Learn: if the user had a suggestion but picked a DIFFERENT category, teach the model
    if (acLastSuggested && acLastSuggested.category !== category && !acUserAccepted) {
      fetch(`${API}/categorize/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ desc, category })
      }).catch(() => {});
    }
    // Also learn from confirmed entry (reinforcement)
    if (acUserAccepted) {
      fetch(`${API}/categorize/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ desc, category })
      }).catch(() => {});
    }

    document.getElementById('expense-form').reset();
    document.getElementById('exp-date').valueAsDate = new Date();
    acHideSuggestion();
    showToast(`${currentType === 'income' ? 'Income' : 'Expense'} added!`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Transaction';
  }
});

// ===== RENDER TRANSACTIONS =====
function renderTransactions() {
  const filterCat = document.getElementById('filter-category').value;
  const filterType = document.getElementById('filter-type').value;

  let filtered = transactions.filter(tx => {
    if (filterCat !== 'all' && tx.category !== filterCat) return false;
    if (filterType !== 'all' && tx.type !== filterType) return false;
    return true;
  });

  renderTxList(document.getElementById('all-transactions'), filtered, true);
  renderTxList(document.getElementById('dash-transactions'), transactions.slice(0, 8), false);
}

function renderTxList(container, txList, showDelete) {
  if (!txList.length) {
    container.innerHTML = '<div class="empty-state"><p>No transactions here yet.</p></div>';
    return;
  }
  container.innerHTML = txList.map(tx => `
    <div class="transaction-item" id="tx-${tx.id}">
      <div class="tx-icon">${CATEGORY_ICONS[tx.category] || '📦'}</div>
      <div class="tx-info">
        <div class="tx-desc">${escapeHtml(tx.desc)}</div>
        <div class="tx-meta">${tx.category} · ${formatDate(tx.date)}</div>
      </div>
      <div class="tx-amount ${tx.type}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</div>
      ${showDelete ? `
        <button class="tx-delete" onclick="deleteTransaction(${tx.id})" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>` : ''}
    </div>
  `).join('');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.deleteTransaction = async function (id) {
  const el = document.getElementById('tx-' + id);
  if (el) { el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; }
  try {
    await apiFetch(`/transactions/${id}`, { method: 'DELETE' });
    transactions = transactions.filter(t => t.id !== id);
    renderTransactions();
    updateDashboard();
    showToast('Transaction deleted');
  } catch (_) {
    if (el) { el.style.opacity = ''; el.style.pointerEvents = ''; }
  }
};

document.getElementById('filter-category').addEventListener('change', renderTransactions);
document.getElementById('filter-type').addEventListener('change', renderTransactions);

// ===== DASHBOARD =====
function getTotals() {
  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { income, expense, savings: income - expense };
}

function updateDashboard() {
  const { income, expense, savings } = getTotals();
  document.getElementById('dash-income').textContent   = fmtIN ? fmtIN(income)   : fmt(income);
  document.getElementById('dash-expense').textContent  = fmtIN ? fmtIN(expense)  : fmt(expense);
  document.getElementById('dash-savings').textContent  = fmtIN ? fmtIN(savings)  : fmt(savings);
  document.getElementById('sidebar-balance').textContent = fmtIN ? fmtIN(savings) : fmt(savings);

  const taxEst = calcNewRegimeTax(income, 'below60');
  document.getElementById('dash-tax').textContent = fmt(taxEst.tax);

  renderTransactions();
  renderTrendChart();
  renderCategoryChart();
  if (typeof indiaFestiveCheck === 'function') indiaFestiveCheck();
}

function getMonthlyData() {
  const months = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    const key = t.date.slice(0, 7);
    months[key] = (months[key] || 0) + t.amount;
  });
  const sorted = Object.keys(months).sort();
  return {
    labels: sorted.map(k => {
      const [y, m] = k.split('-');
      return new Date(+y, +m - 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
    }),
    values: sorted.map(k => months[k]),
    raw: sorted
  };
}

function getCategoryData() {
  const cats = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    cats[t.category] = (cats[t.category] || 0) + t.amount;
  });
  return cats;
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

const CHART_COLORS = [
  '#6c63ff', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#14b8a6', '#a855f7'
];

function renderTrendChart() {
  const { labels, values } = getMonthlyData();
  destroyChart('trend');
  const ctx = document.getElementById('trendChart').getContext('2d');
  charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['No data'],
      datasets: [{
        label: 'Monthly Expenses',
        data: values.length ? values : [0],
        borderColor: '#6c63ff',
        backgroundColor: 'rgba(108,99,255,0.12)',
        fill: true, tension: 0.4,
        pointBackgroundColor: '#6c63ff', pointBorderColor: '#fff',
        pointRadius: 5, pointHoverRadius: 7,
      }]
    },
    options: chartDefaults({ prefix: '₹' })
  });
}

function renderCategoryChart() {
  const cats = getCategoryData();
  const labels = Object.keys(cats);
  const values = Object.values(cats);
  destroyChart('cat');
  const ctx = document.getElementById('categoryChart').getContext('2d');
  charts.cat = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['No expenses'],
      datasets: [{ data: values.length ? values : [1], backgroundColor: CHART_COLORS, borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#475569', font: { size: 11 }, padding: 12, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)}` } }
      },
      cutout: '65%'
    }
  });
}

function chartDefaults({ prefix = '' } = {}) {
  return {
    responsive: true, maintainAspectRatio: true,
    plugins: {
      legend: { labels: { color: '#475569', font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${prefix}${Number(ctx.raw).toLocaleString('en-IN')}` } }
    },
    scales: {
      x: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: 'rgba(15,23,42,0.06)' } },
      y: {
        ticks: { color: '#64748b', font: { size: 11 }, callback: (v) => prefix + Number(v).toLocaleString('en-IN') },
        grid: { color: 'rgba(15,23,42,0.06)' }, beginAtZero: true
      }
    }
  };
}

// ===== PREDICTION =====
function updateInsights() {
  const { values } = getMonthlyData();
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  document.getElementById('ins-avg-spend').textContent = fmt(avg);
  document.getElementById('ins-highest').textContent = fmt(values.length ? Math.max(...values) : 0);
  document.getElementById('ins-lowest').textContent = fmt(values.length ? Math.min(...values) : 0);
  const cats = getCategoryData();
  const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('ins-top-cat').textContent = topCat ? topCat[0] : 'N/A';
}

document.getElementById('predict-btn').addEventListener('click', () => {
  const months = parseInt(document.getElementById('pred-months').value);
  const inflationRate = parseFloat(document.getElementById('inflation-rate').value) / 100;
  const salaryGrowth = parseFloat(document.getElementById('salary-growth').value) / 100;
  const { values: pastValues } = getMonthlyData();

  if (!pastValues.length) { showToast('Add some expenses first!', 'error'); return; }

  const avg = pastValues.reduce((a, b) => a + b, 0) / pastValues.length;
  const trend = pastValues.length > 1 ? (pastValues[pastValues.length - 1] - pastValues[0]) / pastValues.length * 0.3 : 0;
  const now = new Date();
  const { income } = getTotals();
  const monthlyIncome = income / Math.max(pastValues.length, 1);

  const futureLabels = [], futureExpenses = [], futureIncome = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i);
    futureLabels.push(d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }));
    futureExpenses.push(Math.round((avg + trend * i) * Math.pow(1 + inflationRate, i / 12)));
    futureIncome.push(Math.round(monthlyIncome * Math.pow(1 + salaryGrowth, i / 12)));
  }

  const totalPredExpense = futureExpenses.reduce((a, b) => a + b, 0);
  const totalPredIncome = futureIncome.reduce((a, b) => a + b, 0);

  destroyChart('pred');
  charts.pred = new Chart(document.getElementById('predChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: futureLabels,
      datasets: [
        { label: 'Predicted Expenses', data: futureExpenses, backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 6 },
        { label: 'Predicted Income', data: futureIncome, backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 6 },
      ]
    },
    options: chartDefaults({ prefix: '₹' })
  });

  document.getElementById('pred-summary').innerHTML = `
    <h4 style="margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em">
      Forecast — Next ${months} months
    </h4>
    <div class="pred-row"><span>Total Predicted Expenses</span><strong style="color:var(--expense-color)">${fmt(totalPredExpense)}</strong></div>
    <div class="pred-row"><span>Total Predicted Income</span><strong style="color:var(--income-color)">${fmt(totalPredIncome)}</strong></div>
    <div class="pred-row"><span>Projected Savings</span><strong style="color:var(--accent)">${fmt(totalPredIncome - totalPredExpense)}</strong></div>
    <div class="pred-row"><span>Avg Monthly Expense</span><strong>${fmt(totalPredExpense / months)}</strong></div>
    <div class="pred-row"><span>Inflation Rate</span><strong style="color:var(--accent2)">${(inflationRate * 100).toFixed(1)}% p.a.</strong></div>
    <div class="pred-row"><span>Income Growth</span><strong style="color:var(--income-color)">${(salaryGrowth * 100).toFixed(1)}% p.a.</strong></div>
  `;
  updateInsights();
});

// ===== TAX CALCULATOR =====
document.getElementById('regime-new').addEventListener('click', () => {
  currentRegime = 'new';
  document.getElementById('regime-new').classList.add('active');
  document.getElementById('regime-old').classList.remove('active');
  document.getElementById('old-regime-deductions').style.display = 'none';
});
document.getElementById('regime-old').addEventListener('click', () => {
  currentRegime = 'old';
  document.getElementById('regime-old').classList.add('active');
  document.getElementById('regime-new').classList.remove('active');
  document.getElementById('old-regime-deductions').style.display = 'block';
});

function calcNewRegimeTax(income, ageGroup) {
  const stdDeduction = 75000;
  let taxableIncome = Math.max(0, income - stdDeduction);
  const slabs = [
    { upto: 400000, rate: 0 }, { upto: 800000, rate: 0.05 }, { upto: 1200000, rate: 0.10 },
    { upto: 1600000, rate: 0.15 }, { upto: 2000000, rate: 0.20 }, { upto: 2400000, rate: 0.25 }, { upto: Infinity, rate: 0.30 }
  ];
  let tax = 0, prev = 0, slabDetail = [];
  for (const slab of slabs) {
    if (taxableIncome <= prev) break;
    const taxable = Math.min(taxableIncome, slab.upto) - prev;
    const slabTax = taxable * slab.rate;
    slabDetail.push({ from: prev, to: Math.min(taxableIncome, slab.upto), rate: slab.rate * 100, tax: slabTax });
    tax += slabTax; prev = slab.upto;
  }
  let rebate = 0;
  if (income <= 1200000) { rebate = Math.min(tax, 60000); tax = Math.max(0, tax - rebate); }
  let surcharge = 0;
  if (income > 50000000) surcharge = tax * 0.37;
  else if (income > 20000000) surcharge = tax * 0.25;
  else if (income > 10000000) surcharge = tax * 0.15;
  else if (income > 5000000) surcharge = tax * 0.10;
  surcharge = Math.round(surcharge);
  const cess = Math.round((tax + surcharge) * 0.04);
  const totalTax = tax + surcharge + cess;
  return { grossIncome: income, taxableIncome, stdDeduction, tax: Math.round(totalTax), basicTax: Math.round(tax), surcharge, cess, rebate: Math.round(rebate), effectiveRate: income > 0 ? ((totalTax / income) * 100).toFixed(2) : '0.00', slabDetail, netIncome: income - totalTax };
}

function calcOldRegimeTax(income, ageGroup, deductions) {
  const stdDeduction = 50000;
  const { ded80c, ded80d, hra, homeLoan, nps } = deductions;
  const totalDeductions = Math.min(ded80c, 150000) + Math.min(ded80d, 25000) + hra + Math.min(homeLoan, 200000) + Math.min(nps, 50000) + stdDeduction;
  let taxableIncome = Math.max(0, income - totalDeductions);
  let slabs;
  if (ageGroup === 'above80') slabs = [{ upto: 500000, rate: 0 }, { upto: 1000000, rate: 0.20 }, { upto: Infinity, rate: 0.30 }];
  else if (ageGroup === '60to80') slabs = [{ upto: 300000, rate: 0 }, { upto: 500000, rate: 0.05 }, { upto: 1000000, rate: 0.20 }, { upto: Infinity, rate: 0.30 }];
  else slabs = [{ upto: 250000, rate: 0 }, { upto: 500000, rate: 0.05 }, { upto: 1000000, rate: 0.20 }, { upto: Infinity, rate: 0.30 }];
  let tax = 0, prev = 0, slabDetail = [];
  for (const slab of slabs) {
    if (taxableIncome <= prev) break;
    const taxable = Math.min(taxableIncome, slab.upto) - prev;
    const slabTax = taxable * slab.rate;
    slabDetail.push({ from: prev, to: Math.min(taxableIncome, slab.upto), rate: slab.rate * 100, tax: slabTax });
    tax += slabTax; prev = slab.upto;
  }
  let rebate = 0;
  if (income <= 500000) { rebate = Math.min(tax, 12500); tax = Math.max(0, tax - rebate); }
  let surcharge = 0;
  if (income > 50000000) surcharge = tax * 0.37;
  else if (income > 20000000) surcharge = tax * 0.25;
  else if (income > 10000000) surcharge = tax * 0.15;
  else if (income > 5000000) surcharge = tax * 0.10;
  surcharge = Math.round(surcharge);
  const cess = Math.round((tax + surcharge) * 0.04);
  const totalTax = tax + surcharge + cess;
  return { grossIncome: income, taxableIncome, totalDeductions, stdDeduction, tax: Math.round(totalTax), basicTax: Math.round(tax), surcharge, cess, rebate: Math.round(rebate), effectiveRate: income > 0 ? ((totalTax / income) * 100).toFixed(2) : '0.00', slabDetail, netIncome: income - totalTax };
}

document.getElementById('calc-tax-btn').addEventListener('click', () => {
  const grossSalary = parseFloat(document.getElementById('gross-salary').value) || 0;
  const otherIncome = parseFloat(document.getElementById('other-income').value) || 0;
  const totalIncome = grossSalary + otherIncome;
  const ageGroup = document.getElementById('tax-age').value;
  if (totalIncome <= 0) { showToast('Please enter your income', 'error'); return; }

  let result;
  if (currentRegime === 'new') {
    result = calcNewRegimeTax(totalIncome, ageGroup);
  } else {
    result = calcOldRegimeTax(totalIncome, ageGroup, {
      ded80c: parseFloat(document.getElementById('ded-80c').value) || 0,
      ded80d: parseFloat(document.getElementById('ded-80d').value) || 0,
      hra: parseFloat(document.getElementById('ded-hra').value) || 0,
      homeLoan: parseFloat(document.getElementById('ded-home-loan').value) || 0,
      nps: parseFloat(document.getElementById('ded-nps').value) || 0,
    });
  }

  document.getElementById('tax-breakdown').innerHTML = `
    <div class="tax-row"><span class="tax-label">Gross Income</span><span class="tax-amt">${fmt(result.grossIncome)}</span></div>
    <div class="tax-row"><span class="tax-label">Standard Deduction</span><span class="tax-amt">- ${fmt(result.stdDeduction)}</span></div>
    ${currentRegime === 'old' && result.totalDeductions > result.stdDeduction ? `<div class="tax-row"><span class="tax-label">Other Deductions</span><span class="tax-amt">- ${fmt(result.totalDeductions - result.stdDeduction)}</span></div>` : ''}
    <div class="tax-row"><span class="tax-label">Taxable Income</span><span class="tax-amt">${fmt(result.taxableIncome)}</span></div>
    <div class="tax-row"><span class="tax-label">Basic Tax</span><span class="tax-amt">${fmt(result.basicTax)}</span></div>
    ${result.rebate > 0 ? `<div class="tax-row"><span class="tax-label">Rebate u/s 87A</span><span class="tax-amt" style="color:var(--accent3)">- ${fmt(result.rebate)}</span></div>` : ''}
    ${result.surcharge > 0 ? `<div class="tax-row"><span class="tax-label">Surcharge</span><span class="tax-amt">${fmt(result.surcharge)}</span></div>` : ''}
    <div class="tax-row"><span class="tax-label">Health & Edu. Cess (4%)</span><span class="tax-amt">${fmt(result.cess)}</span></div>
    <div class="tax-row total"><span class="tax-label">Total Tax Liability</span><span class="tax-amt">${fmt(result.tax)}</span></div>
    <div class="tax-row net"><span class="tax-label">Net Take-Home Income</span><span class="tax-amt">${fmt(result.netIncome)}</span></div>
    <div class="tax-row"><span class="tax-label">Effective Tax Rate</span><span class="tax-amt">${result.effectiveRate}%</span></div>
  `;

  destroyChart('tax');
  charts.tax = new Chart(document.getElementById('taxChart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Net Income', 'Basic Tax', 'Cess', ...(result.surcharge > 0 ? ['Surcharge'] : [])],
      datasets: [{
        data: [result.netIncome, result.basicTax, result.cess, ...(result.surcharge > 0 ? [result.surcharge] : [])],
        backgroundColor: ['#10b981', '#6c63ff', '#f59e0b', '#ef4444'],
        borderWidth: 0, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#475569', font: { size: 11 }, padding: 14, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)}` } }
      },
      cutout: '60%'
    }
  });

  const slabCard = document.getElementById('slab-table-card');
  slabCard.style.display = 'block';
  document.getElementById('slab-table').innerHTML = `<div class="slab-table"><table>
    <thead><tr><th>Income Slab</th><th>Rate</th><th>Tax</th></tr></thead>
    <tbody>
      ${result.slabDetail.map(s => `
        <tr ${s.tax > 0 ? 'class="active-slab"' : ''}>
          <td>${fmt(s.from)} – ${s.to === Infinity ? 'Above' : fmt(s.to)}</td>
          <td>${s.rate}%</td>
          <td>${fmt(s.tax)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
  showToast('Tax calculated!');
});

// ===== INVESTMENT =====
document.querySelectorAll('.inv-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.inv-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.inv-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('inv-' + btn.dataset.inv).classList.add('active');
  });
});

// SIP
document.getElementById('calc-sip-btn').addEventListener('click', () => {
  const monthly = parseFloat(document.getElementById('sip-monthly').value) || 0;
  const rate = parseFloat(document.getElementById('sip-rate').value) || 0;
  const years = parseInt(document.getElementById('sip-years').value) || 0;
  if (!monthly || !rate || !years) { showToast('Fill all SIP fields', 'error'); return; }
  const r = rate / 100 / 12, n = years * 12;
  const total = monthly * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
  const invested = monthly * n;
  const returns = total - invested;
  document.getElementById('sip-result').style.display = 'flex';
  document.getElementById('sip-invested').textContent = fmt(invested);
  document.getElementById('sip-returns').textContent = fmt(returns);
  document.getElementById('sip-total').textContent = fmt(total);
  document.getElementById('sip-gain').textContent = ((returns / invested) * 100).toFixed(1) + '%';
  const yL = [], yI = [], yV = [];
  for (let y = 1; y <= years; y++) { const ni = y * 12; const v = monthly * ((Math.pow(1 + r, ni) - 1) / r) * (1 + r); yL.push('Yr ' + y); yI.push(Math.round(monthly * ni)); yV.push(Math.round(v)); }
  destroyChart('sip');
  charts.sip = new Chart(document.getElementById('sipChart').getContext('2d'), {
    type: 'line', data: {
      labels: yL, datasets: [
        { label: 'Portfolio Value', data: yV, borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.15)', fill: true, tension: 0.4, pointRadius: 3 },
        { label: 'Amount Invested', data: yI, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.4, pointRadius: 3 }
      ]
    }, options: chartDefaults({ prefix: '₹' })
  });
  showToast('SIP calculated!');
});

// FD
document.getElementById('calc-fd-btn').addEventListener('click', () => {
  let principal = parseFloat(document.getElementById('fd-principal').value) || 0;
  let rate = parseFloat(document.getElementById('fd-rate').value) || 0;
  const years = parseInt(document.getElementById('fd-years').value) || 0;
  if (document.getElementById('fd-type').value === 'senior') rate += 0.5;
  if (!principal || !rate || !years) { showToast('Fill all FD fields', 'error'); return; }
  const r = rate / 100 / 4, n = years * 4;
  const maturity = principal * Math.pow(1 + r, n);
  const interest = maturity - principal;
  document.getElementById('fd-result').style.display = 'flex';
  document.getElementById('fd-prin-display').textContent = fmt(principal);
  document.getElementById('fd-interest').textContent = fmt(interest);
  document.getElementById('fd-maturity').textContent = fmt(maturity);
  document.getElementById('fd-yield').textContent = ((maturity / principal - 1) / years * 100).toFixed(2) + '% p.a.';
  const yL = [], yV = [];
  for (let y = 0; y <= years; y++) { yL.push('Yr ' + y); yV.push(Math.round(principal * Math.pow(1 + r, y * 4))); }
  destroyChart('fd');
  charts.fd = new Chart(document.getElementById('fdChart').getContext('2d'), {
    type: 'bar', data: { labels: yL, datasets: [{ label: 'FD Value', data: yV, backgroundColor: '#f59e0b', borderRadius: 6 }] }, options: chartDefaults({ prefix: '₹' })
  });
  showToast('FD calculated!');
});

// PPF
document.getElementById('calc-ppf-btn').addEventListener('click', () => {
  const annual = parseFloat(document.getElementById('ppf-annual').value) || 0;
  const rate = parseFloat(document.getElementById('ppf-rate').value) || 0;
  const years = parseInt(document.getElementById('ppf-years').value) || 15;
  if (!annual || !rate) { showToast('Fill all PPF fields', 'error'); return; }
  if (annual > 150000) { showToast('PPF limit is ₹1,50,000', 'error'); return; }
  const r = rate / 100; let balance = 0;
  const yL = [], yB = [], yI = [];
  for (let y = 1; y <= years; y++) { balance = (balance + annual) * (1 + r); yL.push('Yr ' + y); yB.push(Math.round(balance)); yI.push(annual * y); }
  const invested = annual * years, interest = balance - invested;
  document.getElementById('ppf-result').style.display = 'flex';
  document.getElementById('ppf-invested').textContent = fmt(invested);
  document.getElementById('ppf-interest').textContent = fmt(interest);
  document.getElementById('ppf-maturity').textContent = fmt(balance);
  document.getElementById('ppf-taxsaved').textContent = fmt(Math.min(annual, 150000) * 0.30);
  destroyChart('ppf');
  charts.ppf = new Chart(document.getElementById('ppfChart').getContext('2d'), {
    type: 'line', data: {
      labels: yL, datasets: [
        { label: 'PPF Balance', data: yB, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', fill: true, tension: 0.4, pointRadius: 3 },
        { label: 'Amount Invested', data: yI, borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.06)', fill: true, tension: 0.4, borderDash: [5, 5], pointRadius: 3 }
      ]
    }, options: chartDefaults({ prefix: '₹' })
  });
  showToast('PPF calculated!');
});

// GOAL PLANNER
document.getElementById('calc-goal-btn').addEventListener('click', () => {
  const targetAmount = parseFloat(document.getElementById('goal-amount').value) || 0;
  const years = parseInt(document.getElementById('goal-years').value) || 0;
  const rate = parseFloat(document.getElementById('goal-rate').value) || 0;
  const currentSavings = parseFloat(document.getElementById('current-savings').value) || 0;
  const goalName = document.getElementById('goal-name').value || 'My Goal';
  if (!targetAmount || !years || !rate) { showToast('Fill all Goal fields', 'error'); return; }
  const r = rate / 100 / 12, n = years * 12;
  const fvCurrentSavings = currentSavings * Math.pow(1 + r, n);
  const remainingTarget = Math.max(0, targetAmount - fvCurrentSavings);
  const monthlySip = remainingTarget > 0 ? remainingTarget * r / (Math.pow(1 + r, n) - 1) / (1 + r) : 0;
  const totalInvested = monthlySip * n + currentSavings;
  const projectedCorpus = monthlySip * ((Math.pow(1 + r, n) - 1) / r) * (1 + r) + fvCurrentSavings;
  document.getElementById('goal-result').style.display = 'flex';
  document.getElementById('goal-sip').textContent = fmt(Math.ceil(monthlySip));
  document.getElementById('goal-total-invest').textContent = fmt(totalInvested);
  document.getElementById('goal-corpus').textContent = fmt(projectedCorpus);
  document.getElementById('goal-returns').textContent = fmt(projectedCorpus - totalInvested);
  const yL = [], yCS = [], yGR = [];
  for (let y = 1; y <= years; y++) { const ni = y * 12; const v = monthlySip * ((Math.pow(1 + r, ni) - 1) / r) * (1 + r) + currentSavings * Math.pow(1 + r, ni); yL.push('Yr ' + y); yCS.push(Math.round(monthlySip * ni + currentSavings)); yGR.push(Math.round(v)); }
  destroyChart('goal');
  charts.goal = new Chart(document.getElementById('goalChart').getContext('2d'), {
    type: 'line', data: {
      labels: yL, datasets: [
        { label: `${goalName} Target`, data: Array(years).fill(targetAmount), borderColor: '#ef4444', borderDash: [6, 4], pointRadius: 0, fill: false },
        { label: 'Projected Corpus', data: yGR, borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.12)', fill: true, tension: 0.4, pointRadius: 3 },
        { label: 'Total Invested', data: yCS, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', fill: true, tension: 0.1, pointRadius: 3 }
      ]
    }, options: chartDefaults({ prefix: '₹' })
  });
  showToast('Goal plan created!');
});

// ===== INIT =====
async function init() {
  // 1. Check auth — redirect to login if not authenticated
  try {
    const user = await fetch(API + '/auth/me', { credentials: 'same-origin' });
    if (user.status === 401) {
      window.location.href = '/auth';
      return;
    }
    const userData = await user.json();
    currentUser = userData;

    // Populate user chip in header
    const nameEl = document.getElementById('user-name');
    const avatarEl = document.getElementById('user-avatar');
    if (nameEl && userData.firstname) {
      nameEl.textContent = userData.firstname;
      avatarEl.textContent = userData.firstname.charAt(0).toUpperCase();
    }
  } catch (e) {
    window.location.href = '/auth';
    return;
  }

  // 2. Wire up logout button
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await fetch(API + '/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      window.location.href = '/auth';
    }
  });

  // 3. Load data
  loadTransactions();
}

init();

// ========================================================
// ===== SMART INSIGHTS ENGINE ============================
// ========================================================

/**
 * Benchmark data — Indian urban averages (approximate, used for comparisons).
 * Expressed as % of monthly take-home income.
 */
const INDIA_BENCHMARKS = {
  'Food & Dining':  0.30,   // 30% of income on food is high
  'Transport':      0.10,
  'Shopping':       0.12,
  'Entertainment':  0.08,
  'Health':         0.05,
  'Utilities':      0.07,
  'Rent':           0.35,
  'Education':      0.08,
};

const CATEGORY_TIPS = {
  'Food & Dining':  { reduce: 500, unit: 'meal deliveries/week', saving: 1800 },
  'Shopping':       { reduce: 1, unit: 'impulse buys/week', saving: 1200 },
  'Entertainment':  { reduce: 1, unit: 'OTT subscription', saving: 300 },
  'Transport':      { reduce: 2, unit: 'cab rides/week', saving: 1600 },
};

function getMonthlyExpenseByCategory() {
  const byMonth = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    const month = t.date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = {};
    byMonth[month][t.category] = (byMonth[month][t.category] || 0) + t.amount;
  });
  return byMonth;
}

function getAvgMonthlyByCategory() {
  const byMonth = getMonthlyExpenseByCategory();
  const months = Object.keys(byMonth);
  if (!months.length) return {};
  const totals = {};
  months.forEach(m => {
    Object.entries(byMonth[m]).forEach(([cat, amt]) => {
      totals[cat] = (totals[cat] || 0) + amt;
    });
  });
  const avg = {};
  Object.entries(totals).forEach(([cat, total]) => {
    avg[cat] = total / months.length;
  });
  return avg;
}

function generateInsights() {
  const insights = [];
  const expenses = transactions.filter(t => t.type === 'expense');
  const incomes  = transactions.filter(t => t.type === 'income');
  if (!expenses.length) return insights;

  const totalExpense = expenses.reduce((s, t) => s + t.amount, 0);
  const totalIncome  = incomes.reduce((s, t)  => s + t.amount, 0);

  const { values: monthlyVals, raw: monthKeys } = getMonthlyData();
  const numMonths = Math.max(monthlyVals.length, 1);
  const avgMonthlyExpense = totalExpense / numMonths;
  const avgMonthlyIncome  = totalIncome  / numMonths;
  const avgByCat = getAvgMonthlyByCategory();
  const topCats  = Object.entries(avgByCat).sort((a, b) => b[1] - a[1]);

  // ---- 1. Savings health score ----
  const savingsRate = avgMonthlyIncome > 0
    ? ((avgMonthlyIncome - avgMonthlyExpense) / avgMonthlyIncome) * 100 : null;
  if (savingsRate !== null) {
    if (savingsRate < 0) {
      insights.push({
        icon: '🚨', type: 'danger',
        title: 'You\'re spending more than you earn!',
        body: `You\'re spending ${fmt(Math.abs(avgMonthlyIncome - avgMonthlyExpense))} more than you earn each month. At this rate your savings will be depleted within ${Math.ceil((totalIncome - totalExpense > 0 ? totalIncome - totalExpense : 0) / Math.abs(avgMonthlyExpense - avgMonthlyIncome)) || '?'} months.`,
        action: 'Review your biggest expense categories immediately.'
      });
    } else if (savingsRate < 10) {
      insights.push({
        icon: '⚠️', type: 'warning',
        title: `Savings rate is only ${savingsRate.toFixed(1)}%`,
        body: `You save just ${savingsRate.toFixed(1)}% of your income. Financial experts recommend at least 20%. Try cutting one discretionary category.`,
        action: `Increase savings by ${fmt((avgMonthlyIncome * 0.2) - (avgMonthlyIncome - avgMonthlyExpense))}/month to hit the 20% target.`
      });
    } else if (savingsRate >= 30) {
      insights.push({
        icon: '🏆', type: 'positive',
        title: `Excellent! You save ${savingsRate.toFixed(1)}% of income`,
        body: `Your savings rate of ${savingsRate.toFixed(1)}% puts you in the top tier of Indian savers. Consider investing the surplus in SIP or PPF to make it work harder.`,
        action: 'Check the Investment tab to start a SIP with your monthly surplus.'
      });
    } else {
      insights.push({
        icon: '✅', type: 'positive',
        title: `You save ${savingsRate.toFixed(1)}% of your income`,
        body: `You\'re saving ${fmt(avgMonthlyIncome - avgMonthlyExpense)}/month on average. A solid habit — keep growing it!`,
        action: 'Try to push savings to 30% by trimming your top expense category.'
      });
    }
  }

  // ---- 2. Top category vs benchmark ----
  if (topCats.length && avgMonthlyIncome > 0) {
    const [topCat, topAmt] = topCats[0];
    const benchmark = INDIA_BENCHMARKS[topCat];
    if (benchmark) {
      const benchmarkAmt = avgMonthlyIncome * benchmark;
      const overPct = ((topAmt - benchmarkAmt) / benchmarkAmt * 100);
      if (overPct > 25) {
        insights.push({
          icon: '📈', type: 'warning',
          title: `You spend ${overPct.toFixed(0)}% more on ${topCat} than average`,
          body: `Your average monthly ${topCat} spend is ${fmt(topAmt)}, while the Indian urban average for your income level is around ${fmt(benchmarkAmt)}.`,
          action: `Reducing ${topCat} by just 20% would save you ${fmt(topAmt * 0.2)}/month — that\'s ${fmt(topAmt * 0.2 * 12)}/year!`
        });
      }
    }
  }

  // ---- 3. Spending velocity trend ----
  if (monthlyVals.length >= 2) {
    const recent  = monthlyVals.slice(-2);
    const pctChange = ((recent[1] - recent[0]) / recent[0]) * 100;
    if (pctChange > 20) {
      insights.push({
        icon: '🔥', type: 'warning',
        title: `Spending jumped ${pctChange.toFixed(0)}% last month!`,
        body: `Your expenses rose from ${fmt(recent[0])} to ${fmt(recent[1])} — a ${pctChange.toFixed(0)}% spike. Something unusual happened. Check what drove this.`,
        action: 'Review last month\'s transactions and identify the spike category.'
      });
    } else if (pctChange < -20) {
      insights.push({
        icon: '📉', type: 'positive',
        title: `Great — spending dropped ${Math.abs(pctChange).toFixed(0)}% last month!`,
        body: `You reduced expenses from ${fmt(recent[0])} to ${fmt(recent[1])}. Excellent discipline!`,
        action: 'Keep this momentum and redirect savings to investments.'
      });
    }
  }

  // ---- 4. Specific reduction tips ----
  topCats.slice(0, 3).forEach(([cat, avgAmt]) => {
    const tip = CATEGORY_TIPS[cat];
    if (tip && avgAmt > 1000) {
      insights.push({
        icon: '💡', type: 'tip',
        title: `Cut ${cat} by reducing ${tip.unit}`,
        body: `You spend ${fmt(avgAmt)}/month on ${cat}. Reducing by just ${tip.reduce > 100 ? fmt(tip.reduce) : tip.reduce} ${tip.unit} could save roughly ${fmt(tip.saving)}/month.`,
        action: `That\'s ${fmt(tip.saving * 12)}/year — enough to build a solid emergency fund.`
      });
    }
  });

  // ---- 5. 50-30-20 check ----
  if (avgMonthlyIncome > 0) {
    const needsCats  = ['Rent','Utilities','Health','Education','Food & Dining'];
    const wantsCats  = ['Shopping','Entertainment','Transport'];
    const needsSpend = topCats.filter(([c]) =>  needsCats.includes(c)).reduce((s,[,v]) => s+v, 0);
    const wantsSpend = topCats.filter(([c]) => wantsCats.includes(c)).reduce((s,[,v]) => s+v, 0);
    const needsPct   = (needsSpend / avgMonthlyIncome) * 100;
    const wantsPct   = (wantsSpend / avgMonthlyIncome) * 100;
    if (wantsPct > 35) {
      insights.push({
        icon: '🎯', type: 'warning',
        title: `Discretionary spending is ${wantsPct.toFixed(0)}% of income`,
        body: `You spend ${wantsPct.toFixed(0)}% on wants (Shopping, Entertainment, Transport). The healthy rule is max 30%. You\'re over by ${fmt((wantsPct - 30) / 100 * avgMonthlyIncome)}/month.`,
        action: 'Try the 50-30-20 framework: 50% Needs · 30% Wants · 20% Savings.'
      });
    }
  }

  // ---- 6. Best & worst months ----
  if (monthlyVals.length >= 3) {
    const maxIdx = monthlyVals.indexOf(Math.max(...monthlyVals));
    const minIdx = monthlyVals.indexOf(Math.min(...monthlyVals));
    const [my, mm] = monthKeys[maxIdx].split('-');
    const [ly, lm] = monthKeys[minIdx].split('-');
    const maxLabel = new Date(+my, +mm-1).toLocaleString('en-IN', {month: 'long', year: 'numeric'});
    const minLabel = new Date(+ly, +lm-1).toLocaleString('en-IN', {month: 'long', year: 'numeric'});
    insights.push({
      icon: '📅', type: 'neutral',
      title: 'Your spending highs and lows',
      body: `Your highest-spending month was ${maxLabel} at ${fmt(monthlyVals[maxIdx])}. Your lowest was ${minLabel} at ${fmt(monthlyVals[minIdx])}.`,
      action: `Study what made ${minLabel} so frugal — and replicate it!`
    });
  }

  return insights;
}

function renderSmartInsightsStrip() {
  const container = document.getElementById('si-cards');
  if (!container) return;
  const insights = generateInsights();
  if (!insights.length) {
    container.innerHTML = `<div class="si-card si-placeholder"><div class="si-icon">📊</div><p>Add transactions to unlock hyper-personalized insights about your spending habits.</p></div>`;
    return;
  }
  // Show top 3 on dashboard strip
  container.innerHTML = insights.slice(0, 3).map(ins => `
    <div class="si-card si-${ins.type}">
      <div class="si-icon">${ins.icon}</div>
      <div class="si-text">
        <strong>${ins.title}</strong>
        <p>${ins.body}</p>
      </div>
    </div>
  `).join('');
}

function updateSmartInsights() {
  renderSmartInsightsStrip();
  renderFullInsights();
  renderFutureBalance();
  renderSpendingDNA();
}

function renderFullInsights() {
  const grid = document.getElementById('full-insights-grid');
  const tipsGrid = document.getElementById('action-tips-grid');
  if (!grid) return;
  const insights = generateInsights();
  if (!insights.length) {
    grid.innerHTML = `<div class="si-card si-placeholder"><div class="si-icon">🔍</div><p>Add at least 3 transactions to generate deep insights.</p></div>`;
    return;
  }
  grid.innerHTML = insights.map((ins, i) => `
    <div class="si-card si-${ins.type}" style="animation-delay:${i * 0.07}s">
      <div class="si-card-top">
        <div class="si-icon">${ins.icon}</div>
        <span class="si-type-label si-type-${ins.type}">${ins.type.charAt(0).toUpperCase() + ins.type.slice(1)}</span>
      </div>
      <strong class="si-title">${ins.title}</strong>
      <p class="si-body">${ins.body}</p>
      <div class="si-action">👉 ${ins.action}</div>
    </div>
  `).join('');

  // Actionable tips based on data
  if (tipsGrid) {
    const income = transactions.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const numM   = Math.max(getMonthlyData().values.length, 1);
    const mInc   = income / numM;
    const tips   = [
      { icon: '🎯', title: '50-30-20 Rule', body: `Your ideal split: ${fmt(mInc * 0.5)}/mo Needs · ${fmt(mInc * 0.3)}/mo Wants · ${fmt(mInc * 0.2)}/mo Savings.` },
      { icon: '🚨', title: 'Emergency Fund First', body: 'Build 6 months of expenses as an emergency fund before investing. This is your financial airbag.' },
      { icon: '📅', title: 'Review on the 1st of every month', body: 'Spend 10 minutes reviewing last month. You will naturally cut back on categories you see in print.' },
      { icon: '🤖', title: 'Automate your savings', body: 'Set up an auto-transfer to savings on salary day. Pay yourself first, then live on the rest.' },
      { icon: '📲', title: 'Unsubscribe to save', body: 'Audit all your subscriptions — OTT, apps, memberships. Cancel any you haven\'t used in 30 days.' },
      { icon: '🍱', title: 'Meal prep to cut Food spend', body: 'Cooking at home 5 days/week vs ordering can save ₹3,000–₹6,000/month for most Indians.' },
    ];
    tipsGrid.innerHTML = tips.map((t, i) => `
      <div class="si-card si-tip" style="animation-delay:${i * 0.08}s">
        <div class="si-icon">${t.icon}</div>
        <div>
          <h4>${t.title}</h4>
          <p>${t.body}</p>
        </div>
      </div>
    `).join('');
  }
}

function renderFutureBalance() {
  const { values } = getMonthlyData();
  const income  = transactions.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0);
  const currentBalance = income - expense;
  const numM = Math.max(values.length, 1);
  const avgMonthlyExp = expense / numM;
  const avgMonthlyInc = income  / numM;
  const monthlyNet    = avgMonthlyInc - avgMonthlyExp;

  const predict = (months) => Math.round(currentBalance + monthlyNet * months);
  const b1 = predict(1), b3 = predict(3), b6 = predict(6);

  document.getElementById('fb-1m').textContent = fmt(b1);
  document.getElementById('fb-3m').textContent = fmt(b3);
  document.getElementById('fb-6m').textContent = fmt(b6);

  // Style values
  [['fb-1m', b1], ['fb-3m', b3], ['fb-6m', b6]].forEach(([id, val]) => {
    const el = document.getElementById(id);
    el.style.color = val >= 0 ? 'var(--income-color)' : 'var(--expense-color)';
  });

  const badge = document.getElementById('fb-trend-badge');
  if (monthlyNet > 0) {
    badge.textContent = '📈 Growing';
    badge.className = 'fb-badge fb-badge-pos';
  } else {
    badge.textContent = '📉 Declining';
    badge.className = 'fb-badge fb-badge-neg';
  }

  // Mini line chart
  destroyChart('futureBalance');
  const labels = [], data = [];
  const now = new Date();
  labels.push('Now');
  data.push(currentBalance);
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i);
    labels.push(d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }));
    data.push(predict(i));
  }
  const positiveColor  = 'rgba(16,185,129,0.18)';
  const negativeColor  = 'rgba(239,68,68,0.18)';
  charts.futureBalance = new Chart(
    document.getElementById('futureBalanceChart').getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Predicted Balance',
        data,
        borderColor: monthlyNet >= 0 ? '#10b981' : '#ef4444',
        backgroundColor: monthlyNet >= 0 ? positiveColor : negativeColor,
        fill: true, tension: 0.4,
        pointBackgroundColor: data.map(v => v >= 0 ? '#10b981' : '#ef4444'),
        pointRadius: 5, pointHoverRadius: 7,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Balance: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: 'rgba(15,23,42,0.06)' } },
        y: { ticks: { color: '#64748b', font: { size: 11 }, callback: v => '₹' + Number(v).toLocaleString('en-IN') }, grid: { color: 'rgba(15,23,42,0.06)' }, beginAtZero: false }
      }
    }
  });
}

function renderSpendingDNA() {
  const container = document.getElementById('dna-bars');
  if (!container) return;
  const avgByCat = getAvgMonthlyByCategory();
  const entries  = Object.entries(avgByCat).sort((a,b) => b[1]-a[1]);
  if (!entries.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No expense data yet.</p>';
    return;
  }
  const maxAmt = entries[0][1];
  const colorPalette = ['#6c63ff','#10b981','#f59e0b','#ef4444','#3b82f6','#ec4899','#8b5cf6','#06b6d4'];
  container.innerHTML = entries.map(([cat, amt], i) => `
    <div class="dna-row">
      <div class="dna-cat">
        <span class="dna-emoji">${CATEGORY_ICONS[cat] || '📦'}</span>
        <span class="dna-label">${cat}</span>
      </div>
      <div class="dna-bar-track">
        <div class="dna-bar-fill" style="width:${(amt/maxAmt*100).toFixed(1)}%;background:${colorPalette[i % colorPalette.length]}"></div>
      </div>
      <span class="dna-amt">${fmt(amt)}<small>/mo</small></span>
    </div>
  `).join('');
}

// ================================================================
// ===== AI ASSISTANT ENGINE ======================================
// ================================================================

// ---- helpers ----
function aiGetMonthTransactions(offsetMonths = 0) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1 - offsetMonths;
  const key = `${y}-${String(m).padStart(2,'0')}`;
  return transactions.filter(t => t.date.startsWith(key));
}
function aiMonthLabel(offsetMonths = 0) {
  const d = new Date(); d.setMonth(d.getMonth() - offsetMonths);
  return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}
function aiSum(txArr, type) {
  return txArr.filter(t => !type || t.type === type).reduce((s,t) => s+t.amount, 0);
}
function aiTopCat(txArr) {
  const cats = {};
  txArr.filter(t => t.type === 'expense').forEach(t => { cats[t.category] = (cats[t.category]||0) + t.amount; });
  const top = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  return top[0] || null;
}

// ---- NLU engine ----
const MONTH_MAP = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11
};

const TIPS_POOL = [
  '💡 The 50-30-20 rule: 50% on needs, 30% on wants, 20% on savings. Most Indians skip the savings part!',
  '🏦 Build an emergency fund of 6 months\' expenses before investing. This is non-negotiable.',
  '📈 SIP even ₹500/month in an index fund for 20 years can create ₹6+ lakhs. Start today, not tomorrow.',
  '🚫 Avoid lifestyle inflation — if your salary doubles, resist doubling your expenses.',
  '📱 Audit subscriptions every 3 months. Most people forget about 2-3 they no longer use.',
  '🍱 Cooking at home 5 days/week vs ordering can save ₹3,000-₹6,000/month.',
  '💳 Pay credit card dues in FULL every month. Partial payment attracts 36-42% annual interest.',
  '🎯 Set a monthly "no-spend" day challenge. Even 2-3 no-spend days saves ₹1,000+/month.',
  '📅 Automate savings on salary day. Pay yourself first — then spend what remains.',
  '🪙 Gold is not an investment, it\'s a hedge. Don\'t put more than 10% of portfolio in gold.',
];

function aiGenerateReply(query) {
  const q = query.toLowerCase();
  const now = new Date();
  const thisMonth = aiGetMonthTransactions(0);
  const lastMonth = aiGetMonthTransactions(1);

  // ---- Greeting ----
  if (/^(hi|hello|namaste|hey|hola)/.test(q)) {
    const hr = now.getHours();
    const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    return `${greeting}! 😊 I'm FinTrack AI. Ask me about your spending, savings, subscriptions — anything money-related!`;
  }

  // ---- Monthly spend ----
  if (/this month.*spend|spend.*this month|current month|how much.*spend/.test(q)) {
    const exp = aiSum(thisMonth, 'expense');
    const inc = aiSum(thisMonth, 'income');
    const top = aiTopCat(thisMonth);
    if (!exp && !inc) return `📭 No transactions recorded for ${aiMonthLabel(0)} yet. Start logging your expenses!`;
    return `📅 In **${aiMonthLabel(0)}**:\n• Spent: **${fmt(exp)}**\n• Earned: **${fmt(inc)}**\n• Net: **${fmt(inc-exp)}**${top ? `\n• Biggest spend: **${top[0]}** (${fmt(top[1])})` : ''}`;
  }

  // ---- Last month spend ----
  if (/last month|previous month/.test(q)) {
    const exp = aiSum(lastMonth, 'expense');
    const inc = aiSum(lastMonth, 'income');
    if (!exp && !inc) return `📭 No transactions found for ${aiMonthLabel(1)}.`;
    return `📅 In **${aiMonthLabel(1)}**:\n• Spent: **${fmt(exp)}**\n• Earned: **${fmt(inc)}**\n• Net: **${fmt(inc-exp)}**`;
  }

  // ---- Month comparison ----
  if (/compare|vs|versus/.test(q) && /(month|last)/.test(q)) {
    const e0 = aiSum(thisMonth,'expense'), e1 = aiSum(lastMonth,'expense');
    if (!e0 && !e1) return '📭 Not enough data to compare months yet.';
    const diff = e0 - e1, pct = e1 > 0 ? ((diff/e1)*100).toFixed(0) : '--';
    const arrow = diff > 0 ? '📈 Up' : '📉 Down';
    return `${arrow} **${Math.abs(pct)}%** vs last month.\n• ${aiMonthLabel(0)}: **${fmt(e0)}**\n• ${aiMonthLabel(1)}: **${fmt(e1)}**\n${diff > 0 ? '⚠️ You spent more this month. Review what spiked.' : '🎉 Great job cutting spending!'}`;
  }

  // ---- Savings rate ----
  if (/saving|savings rate|save/.test(q)) {
    const inc = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
    const exp = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
    if (!inc) return '📭 Add some income transactions so I can calculate your savings rate.';
    const rate = ((inc-exp)/inc*100).toFixed(1);
    const emoji = +rate >= 30 ? '🏆' : +rate >= 20 ? '✅' : +rate >= 10 ? '⚠️' : '🚨';
    return `${emoji} Your savings rate is **${rate}%** (${fmt(inc-exp)} saved out of ${fmt(inc)} earned).\n${+rate >= 20 ? 'You\'re on track!' : `Aim for 20%. You need ${fmt(inc*0.2-(inc-exp))}/month more in savings.`}`;
  }

  // ---- Income queries ----
  if (/earn|income|salary|credit/.test(q)) {
    const monthInc = aiSum(thisMonth, 'income');
    const totalInc = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
    return `💼 **Income summary:**\n• This month: **${fmt(monthInc)}**\n• All time: **${fmt(totalInc)}**`;
  }

  // ---- Top category ----
  if (/top|biggest|most|highest|major/.test(q) && /(expense|spend|category|categor)/.test(q)) {
    const top = aiTopCat(transactions);
    if (!top) return '📭 No expenses logged yet.';
    const total = transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
    const pct = ((top[1]/total)*100).toFixed(0);
    return `🏆 Your biggest expense category is **${top[0]}** at **${fmt(top[1])}** total (**${pct}%** of all spending).`;
  }

  // ---- Food check ----
  if (/food|eating|swiggy|zomato|restaurant|dining/.test(q)) {
    const foodAmt = transactions.filter(t=>t.type==='expense'&&t.category==='Food & Dining').reduce((s,t)=>s+t.amount,0);
    const totalInc = transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
    const pct = totalInc > 0 ? ((foodAmt/totalInc)*100).toFixed(0) : '--';
    const { values } = getMonthlyData ? getMonthlyData() : { values: [] };
    return `🍕 **Food & Dining spend:** ${fmt(foodAmt)} total (${pct}% of income).\n${+pct > 30 ? '⚠️ That\'s above the 30% benchmark. Try cooking at home 2-3 extra days/week.' : '✅ Your food spending looks reasonable!'}`;
  }

  // ---- Specific month (by name) ----
  for (const [name, mIdx] of Object.entries(MONTH_MAP)) {
    if (q.includes(name)) {
      const y = now.getMonth() < mIdx ? now.getFullYear()-1 : now.getFullYear();
      const key = `${y}-${String(mIdx+1).padStart(2,'0')}`;
      const monthTx = transactions.filter(t => t.date.startsWith(key));
      const exp = aiSum(monthTx,'expense'), inc = aiSum(monthTx,'income');
      if (!exp && !inc) return `📭 No transactions found for ${name.charAt(0).toUpperCase()+name.slice(1)} ${y}.`;
      return `📅 **${name.charAt(0).toUpperCase()+name.slice(1)} ${y}:**\n• Spent: ${fmt(exp)}\n• Earned: ${fmt(inc)}\n• Net: ${fmt(inc-exp)}`;
    }
  }

  // ---- Category queries ----
  for (const cat of ['Transport','Shopping','Entertainment','Health','Education','Utilities','Rent','Salary','Freelance','Investment']) {
    if (q.includes(cat.toLowerCase())) {
      const amt = transactions.filter(t=>t.type==='expense'&&t.category===cat).reduce((s,t)=>s+t.amount,0);
      return `📊 You've spent **${fmt(amt)}** on **${cat}** across all time.`;
    }
  }

  // ---- Biggest transaction ----
  if (/biggest|largest|max|maximum/.test(q) && /transaction|payment/.test(q)) {
    const sorted = [...transactions].sort((a,b)=>b.amount-a.amount);
    if (!sorted.length) return '📭 No transactions yet.';
    const t = sorted[0];
    return `💰 Your biggest transaction is **"${t.desc}"** — **${fmt(t.amount)}** on ${formatDate(t.date)} (${t.category}).`;
  }

  // ---- Count transactions ----
  if (/how many|count|number of/.test(q) && /transaction/.test(q)) {
    return `📋 You have **${transactions.length} transactions** total (${transactions.filter(t=>t.type==='expense').length} expenses, ${transactions.filter(t=>t.type==='income').length} income).`;
  }

  // ---- Tips ----
  if (/tip|advice|suggest|help|improve|better/.test(q)) {
    return TIPS_POOL[Math.floor(Math.random() * TIPS_POOL.length)];
  }

  // ---- Affordability ----
  const amtMatch = q.match(/afford[^\d]*(\d[\d,]*)/);
  if (amtMatch) {
    const target = parseInt(amtMatch[1].replace(/,/g,''));
    const { income, expense } = getTotals();
    const monthly = income - expense;
    return monthly >= target
      ? `✅ Your current monthly surplus is ${fmt(monthly)}, so ${fmt(target)} looks affordable!`
      : `⚠️ Your current surplus is ${fmt(monthly)}/month. ${fmt(target)} would need ${Math.ceil(target/Math.max(monthly,1))} months of full savings.`;
  }

  // ---- Default fallback ----
  return `🤖 I didn't quite catch that. Try asking:\n• "How much did I spend this month?"\n• "What's my savings rate?"\n• "Give me a financial tip"\n\nOr type any category name like "Food", "Transport", "Shopping" to see your spend.`;
}

// ---- Chat UI ----
const aiPanel   = document.getElementById('ai-panel');
const aiFab     = document.getElementById('ai-fab');
const aiClose   = document.getElementById('ai-close');
const aiInput   = document.getElementById('ai-input');
const aiSend    = document.getElementById('ai-send');
const aiMsgs    = document.getElementById('ai-messages');

function aiOpen()  { aiPanel.classList.add('open'); aiInput.focus(); }
function aiClosePanel() { aiPanel.classList.remove('open'); }
aiFab.addEventListener('click', aiOpen);
aiClose.addEventListener('click', aiClosePanel);

function aiAddMsg(text, role) {
  const wrap = document.createElement('div');
  wrap.className = `ai-msg ai-msg-${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble';
  // Handle markdown-style **bold**
  bubble.innerHTML = text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
  wrap.appendChild(bubble);
  aiMsgs.appendChild(wrap);
  aiMsgs.scrollTop = aiMsgs.scrollHeight;
}

function aiTypingBubble() {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ai-msg-bot ai-typing-msg';
  wrap.innerHTML = '<div class="ai-bubble ai-typing"><span></span><span></span><span></span></div>';
  aiMsgs.appendChild(wrap);
  aiMsgs.scrollTop = aiMsgs.scrollHeight;
  return wrap;
}

async function aiSendMessage(query) {
  if (!query.trim()) return;
  aiAddMsg(query, 'user');
  aiInput.value = '';
  const typing = aiTypingBubble();
  await new Promise(r => setTimeout(r, 600 + Math.random()*400));
  typing.remove();
  const reply = aiGenerateReply(query);
  aiAddMsg(reply, 'bot');
}

aiSend.addEventListener('click', () => aiSendMessage(aiInput.value));
aiInput.addEventListener('keydown', e => { if (e.key === 'Enter') aiSendMessage(aiInput.value); });

// Quick chips
document.querySelectorAll('.ai-chip').forEach(btn => {
  btn.addEventListener('click', () => aiSendMessage(btn.dataset.q));
});


// ================================================================
// ===== SUBSCRIPTION TRACKER =====================================
// ================================================================

let subscriptions = [];
let subFilter = 'all';
let selectedEmoji = '📱';

function subMonthlyEquiv(amount, cycle) {
  if (cycle === 'yearly')    return amount / 12;
  if (cycle === 'quarterly') return amount / 3;
  return amount;
}

async function loadSubscriptions() {
  try {
    subscriptions = await apiFetch('/subscriptions');
    renderSubscriptions();
    updateSubSummary();
  } catch (_) {}
}

function updateSubSummary() {
  const active = subscriptions.filter(s => s.active);
  const monthly = active.reduce((sum, s) => sum + subMonthlyEquiv(s.amount, s.billing_cycle), 0);
  document.getElementById('sub-monthly-total').textContent = fmt(monthly);
  document.getElementById('sub-yearly-total').textContent  = fmt(monthly * 12);
  document.getElementById('sub-active-count').textContent  = active.length;
  const nextDates = active.filter(s => s.next_billing).map(s => s.next_billing).sort();
  document.getElementById('sub-next-renewal').textContent = nextDates[0] ? formatDate(nextDates[0]) : '—';
}

const SUB_PALETTE = ['#6c63ff','#10b981','#f59e0b','#ef4444','#3b82f6','#ec4899','#8b5cf6','#06b6d4','#f97316','#84cc16'];

function renderSubscriptions() {
  const container = document.getElementById('sub-cards');
  let list = subFilter === 'active' ? subscriptions.filter(s=>s.active)
           : subFilter === 'paused' ? subscriptions.filter(s=>!s.active)
           : subscriptions;
  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><p>No subscriptions yet. Add one or auto-detect!</p></div>';
    return;
  }
  container.innerHTML = list.map((s, i) => {
    const mEq = subMonthlyEquiv(s.amount, s.billing_cycle);
    const cycleLabel = s.billing_cycle === 'yearly' ? '/yr' : s.billing_cycle === 'quarterly' ? '/qtr' : '/mo';
    const color = SUB_PALETTE[i % SUB_PALETTE.length];
    return `
    <div class="sub-card ${s.active ? '' : 'sub-paused'}" data-id="${s.id}">
      <div class="sub-card-left">
        <div class="sub-emoji" style="background:${color}20;border:2px solid ${color}30">${s.emoji || '📱'}</div>
        <div class="sub-info">
          <div class="sub-name">${escapeHtml(s.name)}</div>
          <div class="sub-meta">${s.category} · ${s.billing_cycle}${s.next_billing ? ' · renews '+formatDate(s.next_billing) : ''}</div>
        </div>
      </div>
      <div class="sub-card-right">
        <div class="sub-amount">
          <span class="sub-amt-main" style="color:${color}">${fmt(s.amount)}${cycleLabel}</span>
          <span class="sub-amt-eq">${s.billing_cycle !== 'monthly' ? fmt(mEq)+'/mo' : ''}</span>
        </div>
        <div class="sub-actions">
          <button class="sub-toggle-btn" onclick="toggleSub(${s.id})" title="${s.active?'Pause':'Resume'}">
            ${s.active ? '⏸' : '▶️'}
          </button>
          <button class="sub-del-btn" onclick="deleteSub(${s.id})" title="Delete">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.toggleSub = async function(id) {
  try {
    const updated = await apiFetch(`/subscriptions/${id}`, { method: 'PATCH' });
    const idx = subscriptions.findIndex(s => s.id === id);
    if (idx >= 0) subscriptions[idx] = updated;
    renderSubscriptions();
    updateSubSummary();
    showToast(updated.active ? 'Subscription resumed' : 'Subscription paused');
  } catch(_) {}
};

window.deleteSub = async function(id) {
  try {
    await apiFetch(`/subscriptions/${id}`, { method: 'DELETE' });
    subscriptions = subscriptions.filter(s => s.id !== id);
    renderSubscriptions();
    updateSubSummary();
    showToast('Subscription deleted');
  } catch(_) {}
};

// Emoji picker
document.querySelectorAll('.emoji-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.emoji-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedEmoji = btn.dataset.emoji;
    document.getElementById('sub-emoji-val').value = selectedEmoji;
  });
});

// Add subscription form
document.getElementById('sub-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name  = document.getElementById('sub-name').value.trim();
  const amount = parseFloat(document.getElementById('sub-amount').value);
  const cycle  = document.getElementById('sub-cycle').value;
  const cat    = document.getElementById('sub-cat').value;
  const next   = document.getElementById('sub-next').value;
  if (!name || !amount) { showToast('Fill name and amount', 'error'); return; }
  try {
    const sub = await apiFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ name, amount, billing_cycle: cycle, category: cat,
                              next_billing: next || null, emoji: selectedEmoji })
    });
    subscriptions.unshift(sub);
    renderSubscriptions();
    updateSubSummary();
    e.target.reset();
    showToast(`${name} added!`);
  } catch(_) {}
});

// Filter tabs
document.querySelectorAll('.sub-ftab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sub-ftab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    subFilter = btn.dataset.filter;
    renderSubscriptions();
  });
});

// Auto-detect
document.getElementById('btn-detect-subs').addEventListener('click', async () => {
  const btn = document.getElementById('btn-detect-subs');
  btn.textContent = '⏳ Scanning…'; btn.disabled = true;
  try {
    const candidates = await apiFetch('/subscriptions/detect');
    const panel = document.getElementById('detect-panel');
    const list  = document.getElementById('detect-list');
    if (!candidates.length) { showToast('No recurring patterns found yet — add more transactions!', 'error'); return; }
    list.innerHTML = candidates.map(c => `
      <div class="detect-item" onclick="addDetected('${escapeHtml(c.name)}', ${c.amount}, '${escapeHtml(c.category)}')" title="Click to add">
        <div class="detect-icon">🔄</div>
        <div class="detect-info">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${c.occurrences} times · avg ${fmt(c.amount)} · last ${formatDate(c.last_date)}</span>
        </div>
        <div class="detect-add-btn">+ Add</div>
      </div>
    `).join('');
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(_) {} finally {
    btn.textContent = '🔍 Auto-detect recurring'; btn.disabled = false;
  }
});

document.getElementById('detect-close').addEventListener('click', () => {
  document.getElementById('detect-panel').style.display = 'none';
});

window.addDetected = function(name, amount, category) {
  document.getElementById('sub-name').value = name;
  document.getElementById('sub-amount').value = amount;
  document.getElementById('sub-cat').value = category;
  document.getElementById('detect-panel').style.display = 'none';
  document.getElementById('sub-name').scrollIntoView({ behavior: 'smooth' });
  showToast('Filled in — review and click Add Subscription');
};


// ================================================================
// ===== INDIAN UX MODULE =========================================
// ================================================================

let useLakhCrore  = true;
let useFYFilter   = true;

// ── Lakh/Crore formatter ──────────────────────────────────────
function fmtIN(n) {
  if (!useLakhCrore) return fmt(n);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return sign + '₹' + (abs / 1e7).toFixed(2).replace(/\.?0+$/, '') + 'Cr';
  if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(2).replace(/\.?0+$/, '') + 'L';
  return fmt(n);
}

// Override fmt globally so the whole app uses the toggle
const _fmtOrig = fmt;
window._fmtOverride = false;

// Toolbar button wiring
document.getElementById('fmt-indian-btn').addEventListener('click', () => {
  useLakhCrore = true;
  document.getElementById('fmt-indian-btn').classList.add('active');
  document.getElementById('fmt-full-btn').classList.remove('active');
  updateDashboard();
});
document.getElementById('fmt-full-btn').addEventListener('click', () => {
  useLakhCrore = false;
  document.getElementById('fmt-full-btn').classList.add('active');
  document.getElementById('fmt-indian-btn').classList.remove('active');
  updateDashboard();
});

// fmtIN is defined below; updateDashboard already calls it via the guard above
// No redefinition needed — the stat patch is done inline

// ── FY Filter (Apr–Mar) ───────────────────────────────────────
function getFYTransactions() {
  const now = new Date();
  const curYear = now.getFullYear();
  const fyStart = now.getMonth() >= 3  // April onwards
    ? `${curYear}-04-01`
    : `${curYear-1}-04-01`;
  const fyEnd   = now.getMonth() >= 3
    ? `${curYear+1}-03-31`
    : `${curYear}-03-31`;
  return transactions.filter(t => t.date >= fyStart && t.date <= fyEnd);
}

document.getElementById('fy-btn').addEventListener('click', () => {
  useFYFilter = true;
  document.getElementById('fy-btn').classList.add('active');
  document.getElementById('alltime-btn').classList.remove('active');
  updateDashboard();
});
document.getElementById('alltime-btn').addEventListener('click', () => {
  useFYFilter = false;
  document.getElementById('alltime-btn').classList.add('active');
  document.getElementById('fy-btn').classList.remove('active');
  updateDashboard();
});

// ── Festive calendar detection ────────────────────────────────
const FESTIVE_CALENDAR = [
  { months: [9,10], name: 'Navratri · Dussehra', emoji: '🪔', tip: 'Festive season! Watch your shopping & gifting budget.' },
  { months: [10],   name: 'Diwali',              emoji: '🎆', tip: 'Diwali spending is typically 2-3x higher. Budget for gifts, sweets & shopping.' },
  { months: [0],    name: 'Makar Sankranti',     emoji: '🪁', tip: 'January is a great month to review your financial goals for the new year.' },
  { months: [2],    name: 'Holi',                emoji: '🎨', tip: 'Holi month — be mindful of impulse buying during the festive cheer!' },
  { months: [3],    name: 'New Financial Year',  emoji: '📅', tip: 'New FY starts! Perfect time to review your tax planning and investments.' },
];

function indiaFestiveCheck() {
  const m = new Date().getMonth();
  const festive = FESTIVE_CALENDAR.find(f => f.months.includes(m));
  const el = document.getElementById('inda-festive');
  if (festive && el) {
    el.style.display = 'flex';
    el.innerHTML = `<span>${festive.emoji}</span><span><strong>${festive.name}</strong> — ${festive.tip}</span>`;
  }
}

// Run festive check on load
indiaFestiveCheck();
