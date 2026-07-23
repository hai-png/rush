import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardHeader } from '@/components/dashboard-header';
import { SettingsForm } from './settings-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Settings · Admin' };

export default async function AdminSettingsPage() {
  await requireRole('platform_admin');
  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Settings" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">System Settings</h1>
        <Card><CardContent className="py-4"><SettingsForm /></CardContent></Card>
      </main>
    </div>
  );
}
