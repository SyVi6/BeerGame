package ee.taltech.beerbot.logic;

import java.util.Map;

public class WeekData {
    public int week;
    public Map<String, RoleState> roles;   // retailer, wholesaler, distributor, factory
    public Map<String, Integer> orders;    // historical orders placed by bot (in weeks array)

    public WeekData(int week, Map<String, RoleState> roles, Map<String, Integer> orders) {
        this.week = week;
        this.roles = roles;
        this.orders = orders;
    }
}
