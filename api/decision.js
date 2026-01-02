const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipSlayer";
const VERSION = "v2.2.0";

const PARAMS = {
    LEAD_TIME: 2,           // Tarneaeg lülide vahel (nädalates) on konstantne.
    INITIAL_ORDER: 10,      // Algne tellimus, kui ajalugu puudub.
    Kp: 0.15,               // Proportsionaalne võimendus (reageerib hetkeveale).
    Ki: 0.10,               // Integraalne võimendus (korrigeerib pikaajalist, kumulatiivset viga).
    INTEGRAL_CLAMP: 45,     // Anti-Windup: integraalviga ei saa minna üle +/- selle väärtuse. KÕIGE OLULISEM PARANDUS!
    ORDER_SMOOTHING: 0.4,   // 40% uus arvutus + 60% eelmine tellimus. Summutab võnkumisi.
    MAX_STEP_CHANGE: 18,    // Rate Limiting: tellimus ei saa muutuda nädalas rohkem kui see väärtus.
    FORECAST_WINDOW: 8,     // Mitu viimast nädalat võtta prognoosi aluseks.
    FORECAST_LAMBDA: 0.35,   // EWMA (eksponentsiaalse silumise) silumisfaktor.
    SAFETY_STOCK_WEEKS: 1.6, // Mitu nädalat prognoositud nõudlust hoida puhverlaos.
};

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];

const asInt = (value) => {
    const num = parseInt(value, 10);
    return isNaN(num) ? 0 : num;
};

// Exponentially Weighted Moving Average
function calculateEWMA(values, lambda) {
    if (!values || values.length === 0) return PARAMS.INITIAL_ORDER;
    let forecast = values[0];
    for (let i = 1; i < values.length; i++) {
        forecast = lambda * values[i] + (1 - lambda) * forecast;
    }
    return Math.max(0, forecast);
}

/**
 * Arvutab otsuse ühele rollile, kasutades stabiliseeritud PI-regulaatorit.
 */
function decideForRole(role, weeks, demandForecast) {
    if (weeks.length === 0) return PARAMS.INITIAL_ORDER;

    // 1. Ajaloo kogumine
    const demandHistory = [];
    const inventoryHistory = [];
    const backlogHistory = [];
    const orderHistory = [];
    weeks.forEach(w => {
        demandHistory.push(asInt(w.roles?.[role]?.incoming_orders));
        inventoryHistory.push(asInt(w.roles?.[role]?.inventory));
        backlogHistory.push(asInt(w.roles?.[role]?.backlog));
        orderHistory.push(asInt(w.orders?.[role]));
    });

    const lastOrder = orderHistory.length > 1 ? orderHistory[orderHistory.length - 2] : PARAMS.INITIAL_ORDER;

    // 2. Prognoos
    const forecast = demandForecast !== undefined
        ? demandForecast
        : calculateEWMA(demandHistory.slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);

    // 3. Laopositsiooni ja vigade arvutamine (koos Anti-Windup'iga)
    let integralError = 0;
    let currentError = 0;
    for (let i = 0; i < weeks.length; i++) {
        const pipeline = orderHistory.slice(Math.max(0, i - PARAMS.LEAD_TIME), i).reduce((sum, val) => sum + val, 0);
        const inventoryPosition = inventoryHistory[i] - backlogHistory[i] + pipeline;
        const targetInvPos = forecast * (PARAMS.LEAD_TIME + PARAMS.SAFETY_STOCK_WEEKS);
        currentError = targetInvPos - inventoryPosition;
        integralError += currentError;
        // ANTI-WINDUP: Piirame integraalosa, et vältida ülereageerimist
        integralError = Math.max(-PARAMS.INTEGRAL_CLAMP, Math.min(PARAMS.INTEGRAL_CLAMP, integralError));
    }

    // 4. PI-regulaatori arvutus
    const P = PARAMS.Kp * currentError;
    const I = PARAMS.Ki * integralError;
    const rawOrder = forecast + P + I;

    // 5. Tellimuse stabiliseerimine
    // Silumine: Segame uue arvutuse eelmise tellimusega, et vältida järske hüppeid
    const smoothedOrder = PARAMS.ORDER_SMOOTHING * rawOrder + (1 - PARAMS.ORDER_SMOOTHING) * lastOrder;

    // Muutuse piiramine: Tellimus ei saa liiga kiiresti muutuda
    const finalOrder = Math.max(
        lastOrder - PARAMS.MAX_STEP_CHANGE,
        Math.min(lastOrder + PARAMS.MAX_STEP_CHANGE, smoothedOrder)
    );

    return Math.round(Math.max(0, finalOrder));
}


export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, message: "Method Not Allowed" });
    }
    const body = req.body || {};

    // Handshake
    if (body.handshake === true) {
        return res.status(200).json({
            ok: true,
            student_email: STUDENT_EMAIL,
            algorithm_name: ALGO_NAME,
            version: VERSION,
            supports: { blackbox: true, glassbox: true },
            message: "BeerBot ready",
            uses_llm: false,
            llm_description: "A stabilized Proportional-Integral (PI) controller featuring anti-windup, order smoothing, and rate limiting to ensure robust and stable supply chain performance.",
            student_comment: "This version actively prevents controller instability and overshoot by clamping integral error and smoothing order changes, aiming for minimal total cost by balancing inventory and backlog without oscillation.",
        });
    }

    const { weeks = [], mode = 'blackbox' } = body;
    const orders = {};

    if (mode === 'glassbox' && weeks.length > 0) {
        // GlassBox: Kõik põhineb jaemüüja tegelikul nõudlusel
        const retailerDemandHistory = weeks.map(w => asInt(w.roles?.retailer?.incoming_orders));
        const demandForecast = calculateEWMA(retailerDemandHistory.slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);
        for (const role of ROLES) {
            orders[role] = decideForRole(role, weeks, demandForecast);
        }
    } else {
        // BlackBox: Igaüks otsustab iseseisvalt
        for (const role of ROLES) {
            orders[role] = decideForRole(role, weeks);
        }
    }

    return res.status(200).json({ orders });
};