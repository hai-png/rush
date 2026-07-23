import { Tabs } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';

// rider tab bar. Bottom tabs for the five primary rider
// screens so users can navigate between them without being stranded.
function TabIcon({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={{ paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' }}>
      <Text style={{ color: active ? '#2563eb' : '#666', fontSize: 12, fontWeight: active ? '600' : '400' }}>
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
        headerStyle: { backgroundColor: '#2563eb' },
        headerTintColor: '#fff',
        headerTitle: 'Addis Ride',
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#e0e0e0' },
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#666',
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
