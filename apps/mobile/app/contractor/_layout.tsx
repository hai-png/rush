import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { colors, fontSize } from '../../src/lib/theme';

// contractor tab bar.
function TabIcon({ label }: { label: string }) {
  return (
    <View style={{ paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' }}>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.xs }}>{label}</Text>
    </View>
  );
}

export default function ContractorLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.white,
        headerTitle: 'Addis Ride — Contractor',
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.borderSubtle },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
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
