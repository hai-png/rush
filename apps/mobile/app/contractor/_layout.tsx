import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';

// contractor tab bar.
function TabIcon({ label }: { label: string }) {
  return (
    <View style={{ paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' }}>
      <Text style={{ color: '#666', fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export default function ContractorLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#2563eb' },
        headerTintColor: '#fff',
        headerTitle: 'Addis Ride — Contractor',
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#e0e0e0' },
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#666',
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Home', tabBarIcon: () => <TabIcon label="Home" /> }} />
      <Tabs.Screen name="trips" options={{ title: 'Trips', tabBarIcon: () => <TabIcon label="Trips" /> }} />
      <Tabs.Screen name="assignments" options={{ title: 'Assignments', tabBarIcon: () => <TabIcon label="Assigns" /> }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings', tabBarIcon: () => <TabIcon label="Earnings" /> }} />
      <Tabs.Screen name="gps-tracker" options={{ title: 'GPS', tabBarIcon: () => <TabIcon label="GPS" /> }} />
    </Tabs>
  );
}
