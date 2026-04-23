"""
FinTrack India — Flask Backend
Serves the frontend and provides a REST API backed by SQLite.

Run with:  python app.py
Open:      http://localhost:5000
"""

import sqlite3
import os
import functools
from flask import Flask, request, jsonify, send_from_directory, session, redirect
from flask_cors import CORS
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

# ─────────────────────────────────────────────
# App setup
# ─────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, "fintrack.db")

app = Flask(__name__, static_folder=BASE_DIR)
app.secret_key = os.environ.get("FINTRACK_SECRET", "fintrack-india-dev-secret-change-in-prod")
CORS(app, supports_credentials=True)  # allow browser fetch() from the same host


# ─────────────────────────────────────────────
# Database helpers
# ─────────────────────────────────────────────
def get_db():
    """Open a database connection with row_factory for dict-like rows."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create all tables if they don't exist."""
    with get_db() as conn:
        # Users table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                firstname  TEXT    NOT NULL,
                lastname   TEXT    NOT NULL,
                email      TEXT    NOT NULL UNIQUE,
                password   TEXT    NOT NULL,
                created_at TEXT    DEFAULT (datetime('now','localtime'))
            )
        """)
        # Transactions table (with user_id foreign key)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id   INTEGER NOT NULL DEFAULT 1,
                "desc"    TEXT    NOT NULL,
                amount    REAL    NOT NULL CHECK(amount > 0),
                category  TEXT    NOT NULL,
                date      TEXT    NOT NULL,
                type      TEXT    NOT NULL CHECK(type IN ('income', 'expense')),
                created_at TEXT   DEFAULT (datetime('now','localtime'))
            )
        """)
        # Learned categorisation rules — per-user keyword → category mappings
        conn.execute("""
            CREATE TABLE IF NOT EXISTS learned_rules (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                keyword    TEXT    NOT NULL,
                category   TEXT    NOT NULL,
                hits       INTEGER NOT NULL DEFAULT 1,
                created_at TEXT    DEFAULT (datetime('now','localtime')),
                UNIQUE(user_id, keyword)
            )
        """)
        # Subscriptions — recurring payment tracker
        conn.execute("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL,
                name          TEXT    NOT NULL,
                amount        REAL    NOT NULL,
                billing_cycle TEXT    NOT NULL DEFAULT 'monthly',
                next_billing  TEXT,
                category      TEXT    NOT NULL DEFAULT 'Entertainment',
                emoji         TEXT    DEFAULT '📱',
                active        INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT    DEFAULT (datetime('now','localtime'))
            )
        """)
        conn.commit()
    print(f"[OK] Database ready -> {DB_PATH}")


# ─────────────────────────────────────────────
# Auth helpers
# ─────────────────────────────────────────────
def login_required(f):
    """Decorator: returns 401 if no user is logged in."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"error": "Unauthorized. Please log in."}), 401
        return f(*args, **kwargs)
    return decorated


def current_user_id():
    return session.get('user_id')


# ─────────────────────────────────────────────
# Serve the frontend
# ─────────────────────────────────────────────
@app.route("/")
def index():
    if 'user_id' not in session:
        return redirect("/auth")
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/auth")
def auth_page():
    if 'user_id' in session:
        return redirect("/")
    return send_from_directory(BASE_DIR, "auth.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)


# ─────────────────────────────────────────────
# API — Auth
# ─────────────────────────────────────────────

@app.route("/api/auth/register", methods=["POST"])
def register():
    """Register a new user.

    Expected JSON body:
        { "firstname": str, "lastname": str, "email": str, "password": str }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    required = ["firstname", "lastname", "email", "password"]
    missing  = [f for f in required if not data.get(f, "").strip()]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    email    = data["email"].strip().lower()
    password = data["password"]

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    pw_hash = generate_password_hash(password)

    try:
        with get_db() as conn:
            cur = conn.execute(
                "INSERT INTO users (firstname, lastname, email, password) VALUES (?,?,?,?)",
                (data["firstname"].strip(), data["lastname"].strip(), email, pw_hash)
            )
            conn.commit()
            user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with this email already exists"}), 409

    session.permanent = True
    session["user_id"]    = user_id
    session["user_email"] = email
    session["user_name"]  = data["firstname"].strip()

    return jsonify({
        "message": "Account created successfully",
        "user": {"id": user_id, "email": email, "name": data["firstname"].strip()}
    }), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    """Log in with email and password.

    Expected JSON body:
        { "email": str, "password": str }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()

    if not user or not check_password_hash(user["password"], password):
        return jsonify({"error": "Invalid email or password"}), 401

    session.permanent = True
    session["user_id"]    = user["id"]
    session["user_email"] = user["email"]
    session["user_name"]  = user["firstname"]

    return jsonify({
        "message": "Logged in successfully",
        "user": {"id": user["id"], "email": user["email"], "name": user["firstname"]}
    })


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    """Clear the user session."""
    session.clear()
    return jsonify({"message": "Logged out successfully"})


@app.route("/api/auth/me", methods=["GET"])
@login_required
def me():
    """Return the currently logged-in user's info."""
    with get_db() as conn:
        user = conn.execute(
            "SELECT id, firstname, lastname, email, created_at FROM users WHERE id = ?",
            (current_user_id(),)
        ).fetchone()
    if not user:
        session.clear()
        return jsonify({"error": "User not found"}), 404
    return jsonify(dict(user))


# ─────────────────────────────────────────────
# API — Transactions
# ─────────────────────────────────────────────

@app.route("/api/transactions", methods=["GET"])
@login_required
def get_transactions():
    """Return all transactions for the current user ordered newest-first."""
    category = request.args.get("category")   # optional filter
    tx_type  = request.args.get("type")        # optional filter

    query  = "SELECT * FROM transactions WHERE user_id = ?"
    params = [current_user_id()]

    if category and category != "all":
        query  += " AND category = ?"
        params.append(category)
    if tx_type and tx_type != "all":
        query  += " AND type = ?"
        params.append(tx_type)

    query += " ORDER BY date DESC, created_at DESC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return jsonify([dict(r) for r in rows])


@app.route("/api/transactions", methods=["POST"])
@login_required
def add_transaction():
    """Add a new transaction for the current user.

    Expected JSON body:
        { "desc": str, "amount": float, "category": str,
          "date": "YYYY-MM-DD", "type": "income"|"expense" }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    # Validate required fields
    required = ["desc", "amount", "category", "date", "type"]
    missing  = [f for f in required if f not in data or data[f] == ""]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    if data["type"] not in ("income", "expense"):
        return jsonify({"error": "type must be 'income' or 'expense'"}), 400

    try:
        amount = float(data["amount"])
        if amount <= 0:
            raise ValueError
    except ValueError:
        return jsonify({"error": "amount must be a positive number"}), 400

    # Validate date format
    try:
        datetime.strptime(data["date"], "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "date must be in YYYY-MM-DD format"}), 400

    with get_db() as conn:
        cur = conn.execute(
            'INSERT INTO transactions (user_id, "desc", amount, category, date, type) VALUES (?,?,?,?,?,?)',
            (current_user_id(), data["desc"].strip(), amount, data["category"], data["date"], data["type"])
        )
        conn.commit()
        new_id = cur.lastrowid
        row = conn.execute("SELECT * FROM transactions WHERE id = ?", (new_id,)).fetchone()

    return jsonify(dict(row)), 201


@app.route("/api/transactions/<int:tx_id>", methods=["DELETE"])
@login_required
def delete_transaction(tx_id):
    """Delete a transaction by ID (only the owner can delete)."""
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM transactions WHERE id = ? AND user_id = ?",
            (tx_id, current_user_id())
        ).fetchone()
        if not existing:
            return jsonify({"error": "Transaction not found"}), 404
        conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
        conn.commit()

    return jsonify({"message": "Transaction deleted", "id": tx_id})


# ─────────────────────────────────────────────
# API — Summary
# ─────────────────────────────────────────────

@app.route("/api/summary", methods=["GET"])
@login_required
def get_summary():
    """Return aggregated income, expense, savings, and category breakdown."""
    uid = current_user_id()
    with get_db() as conn:
        totals = conn.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS total_income,
                COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS total_expense,
                COUNT(*) AS transaction_count
            FROM transactions WHERE user_id = ?
        """, (uid,)).fetchone()

        categories = conn.execute("""
            SELECT category, SUM(amount) AS total
            FROM transactions
            WHERE type='expense' AND user_id = ?
            GROUP BY category
            ORDER BY total DESC
        """, (uid,)).fetchall()

        monthly = conn.execute("""
            SELECT strftime('%Y-%m', date) AS month,
                   SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expenses,
                   SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) AS income
            FROM transactions
            WHERE user_id = ?
            GROUP BY month
            ORDER BY month ASC
        """, (uid,)).fetchall()

    t = dict(totals)
    return jsonify({
        "total_income":       t["total_income"],
        "total_expense":      t["total_expense"],
        "net_savings":        t["total_income"] - t["total_expense"],
        "transaction_count":  t["transaction_count"],
        "category_breakdown": [dict(r) for r in categories],
        "monthly_trend":      [dict(r) for r in monthly],
    })


# ─────────────────────────────────────────────
# Health check
# ─────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "app": "FinTrack India", "db": DB_PATH})


# ─────────────────────────────────────────────
# API — Subscriptions
# ─────────────────────────────────────────────

@app.route("/api/subscriptions", methods=["GET"])
@login_required
def get_subscriptions():
    uid = current_user_id()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM subscriptions WHERE user_id = ? ORDER BY active DESC, amount DESC",
            (uid,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/subscriptions", methods=["POST"])
@login_required
def add_subscription():
    data = request.get_json(silent=True) or {}
    required = ["name", "amount", "billing_cycle", "category"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing: {', '.join(missing)}"}), 400
    try:
        amount = float(data["amount"])
        if amount <= 0: raise ValueError
    except ValueError:
        return jsonify({"error": "amount must be positive"}), 400
    uid = current_user_id()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO subscriptions (user_id,name,amount,billing_cycle,next_billing,category,emoji,active) VALUES (?,?,?,?,?,?,?,1)",
            (uid, data["name"].strip(), amount, data["billing_cycle"],
             data.get("next_billing"), data["category"],
             data.get("emoji", "📱"))
        )
        conn.commit()
        row = conn.execute("SELECT * FROM subscriptions WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route("/api/subscriptions/<int:sub_id>", methods=["PATCH"])
@login_required
def toggle_subscription(sub_id):
    uid = current_user_id()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id,active FROM subscriptions WHERE id=? AND user_id=?", (sub_id, uid)
        ).fetchone()
        if not existing: return jsonify({"error": "Not found"}), 404
        new_active = 0 if existing["active"] else 1
        conn.execute("UPDATE subscriptions SET active=? WHERE id=?", (new_active, sub_id))
        conn.commit()
        row = conn.execute("SELECT * FROM subscriptions WHERE id=?", (sub_id,)).fetchone()
    return jsonify(dict(row))


@app.route("/api/subscriptions/<int:sub_id>", methods=["DELETE"])
@login_required
def delete_subscription(sub_id):
    uid = current_user_id()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM subscriptions WHERE id=? AND user_id=?", (sub_id, uid)
        ).fetchone()
        if not existing: return jsonify({"error": "Not found"}), 404
        conn.execute("DELETE FROM subscriptions WHERE id=?", (sub_id,))
        conn.commit()
    return jsonify({"message": "Deleted", "id": sub_id})


@app.route("/api/subscriptions/detect", methods=["GET"])
@login_required
def detect_subscriptions():
    """Detect recurring transactions that look like subscriptions."""
    uid = current_user_id()
    import re as _re2
    with get_db() as conn:
        rows = conn.execute(
            'SELECT "desc", amount, category, date FROM transactions WHERE user_id=? AND type="expense" ORDER BY date',
            (uid,)
        ).fetchall()
    # Group by normalised description
    from collections import defaultdict
    groups = defaultdict(list)
    for r in rows:
        key = _re2.sub(r'\d', '', r["desc"].lower().strip())  # strip digits to normalise
        groups[key].append({"desc": r["desc"], "amount": r["amount"],
                            "category": r["category"], "date": r["date"]})
    candidates = []
    for key, entries in groups.items():
        if len(entries) < 2: continue
        amounts = [e["amount"] for e in entries]
        avg_amt = sum(amounts) / len(amounts)
        deviation = max(abs(a - avg_amt) / avg_amt for a in amounts) if avg_amt else 1
        if deviation > 0.15: continue  # skip if amounts vary >15%
        latest = sorted(entries, key=lambda x: x["date"])[-1]
        candidates.append({
            "name": latest["desc"],
            "amount": round(avg_amt, 2),
            "category": latest["category"],
            "occurrences": len(entries),
            "last_date": latest["date"]
        })
    return jsonify(sorted(candidates, key=lambda x: -x["amount"])[:15])


# ─────────────────────────────────────────────
# API — Auto-categorisation
# ─────────────────────────────────────────────

# Global Indian-context keyword → category rules (fallback when no learned rule)
GLOBAL_RULES = [
    # Food & Dining
    (r'swiggy|zomato|dunzo|blinkit|zepto|bigbasket|grofers|jiomart|domino|pizza|burger|kfc|mcdonald|subway|haldiram|amul|restaurant|cafe|dhaba|hotel|lunch|dinner|breakfast|food|meal|tea|coffee|ration|grocery|vegetable|sabzi|fruit|mandi|apna|biryani|idli|dosa', 'Food & Dining'),
    # Transport
    (r'ola|uber|rapido|namma|metro|bmtc|best bus|dtc|ksrtc|gsrtc|irctc|indigo|spicejet|air india|vistara|go air|railways|railway|bus|auto|cab|taxi|petrol|pump|diesel|cng|parking|toll|fastag|flight|train|ticket|travel', 'Transport'),
    # Shopping
    (r'amazon|flipkart|myntra|meesho|ajio|nykaa|snapdeal|shopsy|tata cliq|reliance digital|croma|decathlon|ikea|jiomart|dmart|market|mall|clothes|shoes|kurta|saree|shirt|jeans|dress|bag|watch|jewel|gold|silver|diamond|gadget|mobile|laptop|headphone', 'Shopping'),
    # Entertainment
    (r'netflix|hotstar|disney|prime video|youtube premium|spotify|gaana|jio saavn|zee5|sonyliv|manorama|alt balaji|bookmyshow|pvr|inox|cinepolis|multiplex|concert|event|game|gaming|steam|playstation|xbox|party|club|pub|bar', 'Entertainment'),
    # Health
    (r'apollo|medplus|netmeds|pharmeasy|1mg|practo|healthkart|tata health|maxhealth|fortis|aiims|hospital|clinic|doctor|medicine|pharmacy|medical|health|lab|pathology|diagnostic|blood|test|xray|mri|dental|eye|vision|gym|yoga|fitness', 'Health'),
    # Education
    (r"byju|unacademy|vedantu|toppr|doubtnut|khan academy|coursera|udemy|upgrad|simplilearn|chegg|school|college|university|tuition|coaching|fee|admission|book|stationery|library|course|exam|test series|jee|neet|upsc|cat prep", 'Education'),
    # Utilities
    (r'jio|airtel|bsnl|vi |vodafone|idea|tata sky|dish tv|sun direct|electricity|bses|tpddl|bescom|msedcl|tneb|wbsedcl|water|gas|lpg|indane|bharat gas|broadband|wifi|internet|recharge|bill|utility|postpaid|prepaid|dth', 'Utilities'),
    # Rent
    (r'rent|pg |paying guest|hostel|house|flat|apartment|landlord|society|maintenance|deposit|lease|brokerage|nobroker|magicbricks|99acres|nri rent', 'Rent'),
    # Investment
    (r'mutual fund|sip|nps|ppf|epf|provident|fd |fixed deposit|rd |recurring deposit|stocks|shares|nse|bse|zerodha|groww|kuvera|etmoney|smallcase|gold bond|sgb|elss|debt fund|index fund|etf|demat|ipo', 'Investment'),
    # Salary / Income
    (r'salary|ctc|stipend|payroll|payslip|credited|bank credit|neft received|imps received|bonus|incentive|commission|freelance payment|client payment|invoice paid|received|income|earning|profit|dividend|interest credited', 'Salary'),
    # Freelance
    (r'freelance|fiverr|upwork|toptal|freelancer|project payment|consulting|contract work|gig|side hustle', 'Freelance'),
]

import re as _re

def rule_based_categorize(desc: str) -> str | None:
    """Apply global regex rules to detect category. Returns None if no match."""
    lower = desc.lower()
    for pattern, category in GLOBAL_RULES:
        if _re.search(pattern, lower):
            return category
    return None


@app.route("/api/categorize", methods=["GET"])
@login_required
def categorize():
    """Suggest a category for a description string.

    Query params:
        desc  — the transaction description text

    Returns:
        { category, source }  where source is 'learned' | 'rules' | null
    """
    desc = request.args.get("desc", "").strip()
    if not desc:
        return jsonify({"category": None, "source": None})

    uid = current_user_id()

    # 1. Check user's learned rules first (highest priority)
    lower = desc.lower()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT keyword, category FROM learned_rules WHERE user_id = ? ORDER BY hits DESC",
            (uid,)
        ).fetchall()

    for row in rows:
        if row["keyword"] in lower:
            return jsonify({"category": row["category"], "source": "learned"})

    # 2. Fall back to global rule engine
    cat = rule_based_categorize(desc)
    if cat:
        return jsonify({"category": cat, "source": "rules"})

    return jsonify({"category": None, "source": None})


@app.route("/api/categorize/learn", methods=["POST"])
@login_required
def categorize_learn():
    """Store a user correction so future suggestions improve.

    Expected JSON body:
        { "desc": str, "category": str }
    """
    data = request.get_json(silent=True) or {}
    desc     = data.get("desc", "").strip().lower()
    category = data.get("category", "").strip()

    if not desc or not category:
        return jsonify({"error": "desc and category required"}), 400

    # Extract meaningful keywords (words ≥ 4 chars, skip common stop words)
    STOP = {"with", "from", "this", "that", "have", "been", "will", "into",
            "your", "paid", "payment", "transfer", "upi", "paytm", "gpay",
            "phonpe", "imps", "neft", "rtgs", "bank", "debit", "credit"}
    words = [w for w in _re.findall(r'[a-z0-9]+', desc) if len(w) >= 4 and w not in STOP]

    uid = current_user_id()
    with get_db() as conn:
        for kw in words[:5]:   # store at most 5 keywords per correction
            conn.execute("""
                INSERT INTO learned_rules (user_id, keyword, category, hits)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(user_id, keyword)
                DO UPDATE SET category = excluded.category, hits = hits + 1
            """, (uid, kw, category))
        conn.commit()

    return jsonify({"message": "Learned!", "keywords": words[:5]})


# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    port  = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") != "production"
    print(f"[INFO] FinTrack India backend starting on port {port}...")
    print(f"[INFO] Open http://localhost:{port} in your browser")
    app.run(host="0.0.0.0", port=port, debug=debug)