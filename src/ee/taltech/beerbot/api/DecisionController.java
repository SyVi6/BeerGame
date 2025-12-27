package ee.taltech.beerbot.api;

import ee.taltech.beerbot.api.dto.DecisionRequest;
import ee.taltech.beerbot.api.dto.HandshakeResponse;
import ee.taltech.beerbot.api.dto.WeeklyResponse;
import ee.taltech.beerbot.logic.BeerDecisionLogic;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class DecisionController {

    private static final String STUDENT_EMAIL = "firstname.lastname@taltech.ee"; // <-- MUUDA ÄRA
    private static final String ALGO_NAME = "BullwhipBreaker";                  // 3–32, [A-Za-z0-9_]
    private static final String VERSION = "v1.0.0";                              // semver-like

    private final BeerDecisionLogic logic = new BeerDecisionLogic();

    @PostMapping(value = "/decision", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public Object decide(@RequestBody(required = false) DecisionRequest body) {
        if (body == null) body = new DecisionRequest();

        // Handshake
        if (Boolean.TRUE.equals(body.handshake)) {
            HandshakeResponse r = new HandshakeResponse();
            r.ok = true;
            r.student_email = STUDENT_EMAIL;
            r.algorithm_name = ALGO_NAME;
            r.version = VERSION;
            r.supports = Map.of("blackbox", true, "glassbox", true); // implement both (safe)
            r.message = "BeerBot ready"; // must match spec exactly
            return r;
        }

        // Weekly step
        String mode = (body.mode == null) ? "blackbox" : body.mode;
        Map<String, Integer> orders = logic.decide(mode, body.weeks);

        // Ensure non-negative integer orders (defensive)
        Map<String, Integer> safe = new LinkedHashMap<>();
        safe.put("retailer", Math.max(0, orders.getOrDefault("retailer", 10)));
        safe.put("wholesaler", Math.max(0, orders.getOrDefault("wholesaler", 10)));
        safe.put("distributor", Math.max(0, orders.getOrDefault("distributor", 10)));
        safe.put("factory", Math.max(0, orders.getOrDefault("factory", 10)));

        return new WeeklyResponse(safe);
    }
}
