package ee.taltech.beerbot.logic;

import java.util.*;

public class BeerDecisionLogic {

    // Tunable constants (keep deterministic!)
    private static final int PIPELINE_WEEKS = 2;     // conservative assumption to reduce oscillations
    private static final int SAFETY_STOCK = 8;       // small buffer
    private static final double EWMA_LAMBDA = 0.40;  // demand smoothing
    private static final double ORDER_SMOOTH_BETA = 0.55; // how much we stick to last order
    private static final int MAX_ORDER = 500;        // hard cap to avoid blow-ups

    private static final List<String> ROLES = List.of("retailer", "wholesaler", "distributor", "factory");

    public Map<String, Integer> decide(String mode, List<Map<String, Object>> rawWeeks) {
        List<WeekData> weeks = parseWeeks(rawWeeks);

        Map<String, Integer> result = new LinkedHashMap<>();
        for (String role : ROLES) {
            int order = decideForRole(mode, role, weeks);
            result.put(role, order);
        }
        return result;
    }

    private int decideForRole(String mode, String role, List<WeekData> weeks) {
        if (weeks.isEmpty()) return 10; // safe fallback

        // In "blackbox": use only this role's own fields across history.
        // In "glassbox": we *could* coordinate, but we keep stable and simple (still allowed).
        // Deterministic either way.
        List<Integer> incomingOrdersHist = new ArrayList<>();
        List<Integer> arrivingHist = new ArrayList<>();
        List<Integer> ordersHist = new ArrayList<>();

        for (WeekData wd : weeks) {
            RoleState rs = wd.roles.get(role);
            if (rs != null) {
                incomingOrdersHist.add(rs.incomingOrders);
                arrivingHist.add(rs.arrivingShipments);
            } else {
                incomingOrdersHist.add(0);
                arrivingHist.add(0);
            }
            Integer prevOrder = (wd.orders != null) ? wd.orders.get(role) : null;
            ordersHist.add(prevOrder == null ? 0 : Math.max(0, prevOrder));
        }

        WeekData lastWeek = weeks.get(weeks.size() - 1);
        RoleState last = lastWeek.roles.get(role);
        if (last == null) last = new RoleState(0, 0, 0, 0);

        double forecast = ewma(incomingOrdersHist, EWMA_LAMBDA);

        // "Inventory position" approximation for next decision.
        // We treat arriving shipments as immediate relief and backlog as negative stock.
        int inventoryPosition = safeInt(last.inventory - last.backlog + last.arrivingShipments);

        // Target position: cover (pipeline+1) weeks of demand + safety buffer.
        int target = safeInt(Math.round(forecast * (PIPELINE_WEEKS + 1) + SAFETY_STOCK));

        int rawOrder = target - inventoryPosition;
        if (rawOrder < 0) rawOrder = 0;

        // Additional gentle correction: if backlog exists, nudge up a bit (but avoid oscillation)
        // Deterministic linear term.
        int backlogNudge = safeInt(Math.round(0.15 * last.backlog));
        rawOrder = safeInt(rawOrder + backlogNudge);

        // Smooth with previous order to avoid bullwhip.
        int lastOrder = ordersHist.isEmpty() ? 0 : ordersHist.get(ordersHist.size() - 1);
        int smoothed = (int) Math.round((1.0 - ORDER_SMOOTH_BETA) * rawOrder + ORDER_SMOOTH_BETA * lastOrder);

        // Clamp
        if (smoothed < 0) smoothed = 0;
        if (smoothed > MAX_ORDER) smoothed = MAX_ORDER;

        return smoothed;
    }

    private double ewma(List<Integer> values, double lambda) {
        if (values == null || values.isEmpty()) return 0.0;
        double s = values.get(0);
        for (int i = 1; i < values.size(); i++) {
            s = lambda * values.get(i) + (1.0 - lambda) * s;
        }
        return Math.max(0.0, s);
    }

    @SuppressWarnings("unchecked")
    private List<WeekData> parseWeeks(List<Map<String, Object>> rawWeeks) {
        if (rawWeeks == null) return List.of();
        List<WeekData> out = new ArrayList<>(rawWeeks.size());

        for (Map<String, Object> w : rawWeeks) {
            int week = asInt(w.get("week"));

            Map<String, RoleState> roles = new HashMap<>();
            Object rolesObj = w.get("roles");
            if (rolesObj instanceof Map<?, ?> rolesMap) {
                for (String role : ROLES) {
                    Object rObj = ((Map<?, ?>) rolesMap).get(role);
                    RoleState rs = parseRoleState(rObj);
                    if (rs != null) roles.put(role, rs);
                }
            }

            Map<String, Integer> orders = new HashMap<>();
            Object ordersObj = w.get("orders");
            if (ordersObj instanceof Map<?, ?> om) {
                for (String role : ROLES) {
                    Object v = ((Map<?, ?>) om).get(role);
                    orders.put(role, Math.max(0, asInt(v)));
                }
            }

            out.add(new WeekData(week, roles, orders));
        }
        return out;
    }

    private RoleState parseRoleState(Object obj) {
        if (!(obj instanceof Map<?, ?> m)) return null;
        int inventory = asInt(m.get("inventory"));
        int backlog = asInt(m.get("backlog"));
        int incoming = asInt(m.get("incoming_orders"));
        int arriving = asInt(m.get("arriving_shipments"));
        return new RoleState(inventory, backlog, incoming, arriving);
    }

    private int asInt(Object v) {
        if (v == null) return 0;
        if (v instanceof Integer i) return i;
        if (v instanceof Long l) return (int) Math.min(Integer.MAX_VALUE, Math.max(Integer.MIN_VALUE, l));
        if (v instanceof Double d) return (int) Math.round(d);
        if (v instanceof String s) {
            try { return Integer.parseInt(s.trim()); } catch (Exception ignored) { return 0; }
        }
        return 0;
    }

    private int safeInt(long x) {
        if (x < 0) return 0;
        if (x > Integer.MAX_VALUE) return Integer.MAX_VALUE;
        return (int) x;
    }
}
