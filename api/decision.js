const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.6";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];
const POLICY = {
    retailer:    { qty: 26, period: 1, phase: 0 },
    wholesaler:  { qty: 26, period: 1, phase: 0 },
    distributor: { qty: 36, period: 2, phase: 0 }, // pulse on even-ish weeks
    factory:     { qty: 48, period: 2, phase: 1 }  // pulse on opposite weeks
};

function decideForRole(role, weeks) {
    const p = POLICY[role];

    // Week index (1-based). If no weeks, treat as week 1 decision.
    const t = (weeks?.length || 0) + 1;

    // period=1 -> always order qty
    if (p.period === 1) return p.qty;

    // period=2 (or N): order only when (t + phase) % period == 0
    if (((t + p.phase) % p.period) === 0) return p.qty;

    return 0;
}

module.exports = async (req, res) => {
    if (req.method === "GET") {
        res.status(200).json({ ok: true, message: "BeerBot online. Use POST /api/decision" });
        return;
    }

    if (req.method !== "POST") {
        res.status(405).json({ ok: false, message: "Method Not Allowed" });
        return;
    }

    const body = req.body || {};

    // Handshake
    if (body.handshake === true) {
        res.status(200).json({
            ok: true,
            student_email: STUDENT_EMAIL,
            algorithm_name: ALGO_NAME,
            version: VERSION,
            supports: { blackbox: true, glassbox: true },
            uses_llm: false,
            message: "Deterministic mixed periodicity + phase shift policy (Top2-inspired)"
        });
        return;
    }

    const weeks = Array.isArray(body.weeks) ? body.weeks : [];
    const orders = {};
    for (const role of ROLES) orders[role] = decideForRole(role, weeks);

    res.status(200).json({ orders });
};
