package ee.taltech.beerbot.api.dto;

import java.util.Map;

public class WeeklyResponse {
    public Map<String, Integer> orders;

    public WeeklyResponse(Map<String, Integer> orders) {
        this.orders = orders;
    }
}
