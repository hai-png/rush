import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { colors, fontSize, fontWeight } from '../../src/lib/theme';

function TabIcon({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={{ paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' }}>
      <Text style={{ color: active ? colors.primary : colors.textMuted, fontSize: fontSize.xs, fontWeight: active ? fontWeight.semibold : fontWeight.normal }}>
        {label}
      </Text>
    </View>
  );
}

export default function RiderLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.white,
        headerTitle: 'Addis Ride',
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.borderSubtle },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Home', tabBarIcon: () => <TabIcon label="Home" active={false} /> }}
      />
      <Tabs.Screen
        name="rides"
        options={{ title: 'Rides', tabBarIcon: () => <TabIcon label="Rides" active={false} /> }}
      />
      <Tabs.Screen
        name="tickets"
        options={{ title: 'Tickets', tabBarIcon: () => <TabIcon label="Tickets" active={false} /> }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ title: 'Alerts', tabBarIcon: () => <TabIcon label="Alerts" active={false} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: () => <TabIcon label="Settings" active={false} /> }}
      />
      {/* Non-tab screens in the /rider/ directory — hidden from the tab bar. */}
      <Tabs.Screen name="book" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="live-trip" options={{ href: null }} />
      <Tabs.Screen name="payments" options={{ href: null }} />
      <Tabs.Screen name="subscriptions" options={{ href: null }} />
      <Tabs.Screen name="list-seat" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="listings" options={{ href: null }} />
      <Tabs.Screen name="open-seats" options={{ href: null }} />
      <Tabs.Screen name="ticket-detail" options={{ href: null }} />
      <Tabs.Screen name="ticket-new" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="trips" options={{ href: null }} />
    </Tabs>
  );
}
