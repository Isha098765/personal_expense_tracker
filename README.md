# 💰 FinTrack India — Smart Personal Finance Management System

> A full-stack personal finance web app built specifically for Indian users. Track income & expenses, calculate income tax (Old vs New Regime), detect subscriptions, forecast investments, and get smart spending insights — all in one place, in ₹.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, Flask 3.0, Flask-CORS |
| Database | SQLite3 (via Python's built-in `sqlite3` module) |
| Authentication | Werkzeug password hashing (PBKDF2-SHA256) |
| Frontend | HTML5, CSS3, JavaScript (ES6+) |
| Charts | Chart.js 4.4.0 |
| Fonts | Google Fonts — Inter, Space Grotesk |
| Deployment | Gunicorn 21.2 (WSGI), Procfile (Heroku/Render-ready) |
| PWA | Service Worker (`sw.js`) for offline caching |
| Dev Tools | Git, VS Code, Postman, SQLite Browser |

---

## ✨ Features

### 🔐 User Authentication
- Secure registration and login with hashed passwords
- Server-side session management via Flask
- Per-user data isolation — each user sees only their own data

### 📊 Dashboard
- Real-time KPI cards: Total Income, Total Expenses, Net Savings, Transaction Count
- Monthly income vs. expense bar chart (Chart.js)
- Category-wise expense pie chart

### 💸 Expense Tracker
- Add income/expense transactions with description, amount, category, date
- Sortable, searchable transaction history table
- Delete individual transactions

### 🤖 Auto-Categorisation Engine (Indian-Context)
- Two-tier engine: **Learned Rules** (user-specific) → **Global Rules** (regex-based)
- 200+ Indian keywords across 12 categories:
  `Food & Dining`, `Transport`, `Shopping`, `Entertainment`, `Health`, `Education`, `Utilities`, `Rent`, `Investment`, `Salary`, `Freelance`
- Recognises platforms: Swiggy, Zomato, Ola, Uber, Jio, Airtel, IRCTC, Zerodha, Groww, and many more
- Learns from user corrections via `/api/categorize/learn`

### 🔁 Subscription Management
- Manually add recurring subscriptions (Netflix, Spotify, etc.)
- **Auto-detect** recurring payments from transaction history (amount variance <15%)
- Toggle subscriptions active/paused; delete when cancelled

### 📈 Prediction & Insights
- Future expense prediction based on historical monthly trends
- Smart insights engine: spending alerts, category spikes, savings milestones

### 🧾 Indian Income Tax Calculator (FY 2025-26)
- Supports both **Old Regime** and **New Regime**
- Inputs: gross income, 80C, 80D, HRA, standard deduction
- Side-by-side comparison of tax liability under both regimes including cess

### 💹 Investment Projector
- Project returns on SIP, Fixed Deposit, PPF, and lump-sum equity
- Adjustable principal, rate, tenure, and frequency
- Visual corpus projection chart

### 📱 Progressive Web App (PWA)
- Service worker for offline static asset caching
- Installable on desktop and mobile

---

## 🚀 Installation & Running the Project

### Prerequisites
- Python 3.11 or higher
- pip (Python package manager)
- A modern web browser (Chrome, Firefox, Edge, Safari)

### Steps

**1. Clone or extract the project**
```bash
git clone https://github.com/Isha098765/fintrack-india.git
cd fintrack-india
```

**2. Install dependencies**
```bash
pip install -r requirements.txt
```

**3. Run the application**
```bash
python app.py
```

**4. Open in browser**
```
http://localhost:5000
```

> The SQLite database (`fintrack.db`) is created automatically on first run.

---

### 🌐 Production Deployment (Gunicorn)

```bash
gunicorn wsgi:app
```

For cloud platforms (Heroku, Render), the `Procfile` and `runtime.txt` are already configured:
```
web: gunicorn wsgi:app
```

---

## 📁 Project Structure

```
fintrack-india/
├── app.py              # Flask backend — all routes and business logic
├── wsgi.py             # WSGI entry point for Gunicorn
├── index.html          # Main SPA frontend
├── auth.html           # Login / Registration page
├── style.css           # All frontend styles
├── app.js              # Frontend JavaScript (fetch API, Chart.js)
├── sw.js               # Service worker (PWA offline caching)
├── fintrack.db         # SQLite database (auto-created)
├── requirements.txt    # Python dependencies
├── Procfile            # Heroku/Render deployment config
└── runtime.txt         # Python version pin
```

---

## 👥 Team

| Name | Enrollment No. |
|---|---|
| Isha Jain | EN23CS301446 |
| Ishan Ameriya | EN23CS301451 |
| Harshvardhan Singh Chauhan | EN23CS301427 |

**Under the guidance of:**
Prof. Arpit Deo & Prof. Rashmi Vijaywargiya
Department of Computer Science & Engineering, Medi-Caps University, Indore

---

## 📄 License

This project was developed as a B.Tech Minor Project at Medi-Caps University, Indore (FY 2025-26).
