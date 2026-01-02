const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipSlayer";
const VERSION = "v2.4.0";

const PARAMS = {
    LEAD_TIME: 2,           // Tarneaeg lülide vahel (nädalates) on konstantne.
    INITIAL_ORDER: 10,      // Algne tellimus, kui ajalugu puudub.
    Kp: 0.21,               // Proportsionaalne võimendus (reageerib hetkeveale).
    Ki: 0.16,               // Integraalne võimendus (korrigeerib pikaajalist, kumulatiivset viga).
    Kd: 0.25,               // Derivatiivne: Ennetab ülereageerimist (pidur)
    INTEGRAL_CLAMP: 60,     // Anti-Windup: integraalviga ei saa minna üle +/- selle väärtuse. KÕIGE OLULISEM PARANDUS!
    ORDER_SMOOTHING: 0.65,   // 40% uus arvutus + 60% eelmine tellimus. Summutab võnkumisi.
    MAX_STEP_CHANGE: 25,    // Rate Limiting: tellimus ei saa muutuda nädalas rohkem kui see väärtus.
    FORECAST_WINDOW: 8,     // Mitu viimast nädalat võtta prognoosi aluseks.
    FORECAST_LAMBDA: 0.3,   // EWMA (eksponentsiaalse silumise) silumisfaktor.
    SAFETY_STOCK_WEEKS: 1.5, // Mitu nädalat prognoositud nõudlust hoida puhverlaos.
};

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];

const asInt = (v) => parseInt(v, 10) || 0;

// Exponentially Weighted Moving Average
function calculateEWMA(values, lambda) {
    if (!values || values.length === 0) return PARAMS.INITIAL_ORDER;
    let forecast = values[0];
    for (let i = 1; i < values.length; i++) {
        forecast = lambda * values[i] + (1 - lambda) * forecast;
    }
    return Math.max(0, forecast);
}

function decideForRole(role, weeks, demandForecast) {
    const historyLength = weeks.length;
    if (historyLength === 0) return PARAMS.INITIAL_ORDER;

    const history = weeks.map(w => ({
        demand: asInt(w.roles?.[role]?.incoming_orders),
        inventory: asInt(w.roles?.[role]?.inventory),
        backlog: asInt(w.roles?.[role]?.backlog),
        order: asInt(w.orders?.[role]),
    }));

    const forecast = demandForecast !== undefined
        ? demandForecast
        : calculateEWMA(history.map(h => h.demand).slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);

    // Arvutame vead ja integraali jooksvalt läbi ajaloo
    let integralError = 0;
    let currentError = 0;
    let previousError = 0;

    for (let i = 0; i < historyLength; i++) {
        const onOrder = history.slice(Math.max(0, i - PARAMS.LEAD_TIME), i).reduce((sum, h) => sum + h.order, 0);
        const invPos = history[i].inventory - history[i].backlog + onOrder;
        const targetInvPos = forecast * (PARAMS.LEAD_TIME + PARAMS.SAFETY_STOCK_WEEKS);

        previousError = currentError;
        currentError = targetInvPos - invPos;
        integralError += currentError;
        integralError = Math.max(-PARAMS.INTEGRAL_CLAMP, Math.min(PARAMS.INTEGRAL_CLAMP, integralError));
    }

    // PID-komponendid
    const P = PARAMS.Kp * currentError;
    const I = PARAMS.Ki * integralError;
    const D = PARAMS.Kd * (currentError - previousError); // PIDUR: reageerib vea muutumise kiirusele

    const rawOrder = forecast + P + I + D;

    const lastOrder = historyLength > 1 ? history[historyLength - 2].order : PARAMS.INITIAL_ORDER;
    const smoothedOrder = PARAMS.ORDER_SMOOTHING * rawOrder + (1 - PARAMS.ORDER_SMOOTHING) * lastOrder;

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

    if (body.handshake === true) {
        return res.status(200).json({
            ok: true,
            student_email: STUDENT_EMAIL,
            algorithm_name: ALGO_NAME,
            version: VERSION,
            supports: { blackbox: true, glassbox: true },
            message: "BeerBot ready",
            uses_llm: false,
            llm_description: "A complete Proportional-Integral-Derivative (PID) controller. The derivative term acts as a predictive brake to prevent overshoot, ensuring a fast yet stable response to demand changes.",
            student_comment: "This final version uses a full PID implementation to achieve optimal control, balancing rapid backlog correction with proactive inventory management to minimize total system cost.",
        });
    }

    const { weeks = [], mode = 'blackbox' } = body;
    const orders = {};

    if (mode === 'glassbox' && weeks.length > 0) {
        const retailerDemandHistory = weeks.map(w => asInt(w.roles?.retailer?.incoming_orders));
        const demandForecast = calculateEWMA(retailerDemandHistory.slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);
        for (const role of ROLES) {
            orders[role] = decideForRole(role, weeks, demandForecast);
        }
    } else {
        for (const role of ROLES) {
            orders[role] = decideForRole(role, weeks);
        }
    }

    return res.status(200).json({ orders });
};