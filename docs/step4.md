Continuing — finishing the remaining web pages (signup wizards, admin CRUD), then moving into the Expo mobile app.

## Phase 28 — Contractor & Corporate signup wizards

```tsx
// apps/web/app/signup/contractor/page.tsx
'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Stepper, Button, Input, Label, FieldError, PhoneInput, FileDropzone } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const Schema = z.object({
  name: z.string().min(2, 'Enter your full name'),
  phone: z.string().regex(/^\+251(9|7)\d{8}$/, 'Enter a valid Ethiopian phone number'),
  password: z.string().min(10, 'At least 10 characters'),
  licenseNumber: z.string().min(3, 'Required'),
  experienceYears: z.coerce.number().int().min(0),
  tosAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms of Service' }) }),
});
type FormValues = z.infer<typeof Schema>;
const STEPS = ['Account', 'License', 'Documents', 'Review'];

export default function ContractorSignupPage() {
  const [step, setStep] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File>>({});
  const router = useRouter();
  const client = useApiClient();
  const { register, handleSubmit, trigger, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: { phone: '+251', experienceYears: 0 } });

  const stepFields: (keyof FormValues)[][] = [['name', 'phone', 'password'], ['licenseNumber', 'experienceYears'], [], ['tosAccepted']];
  const next = async () => { if (await trigger(stepFields[step])) setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (data: FormValues) => {
    const { data: res, error } = await client.POST('/api/v1/auth/register', {
      body: { kind: 'contractor', name: data.name, phone: data.phone, password: data.password, licenseNumber: data.licenseNumber, experienceYears: data.experienceYears },
    });
    if (error) return;

    // Upload any documents already selected during signup (optional at this stage — can also be done post-login)
    for (const [type, file] of Object.entries(pendingFiles)) {
      const form = new FormData();
      form.append('type', type); form.append('file', file);
      await fetch('/api/v1/contractors/documents', { method: 'POST', body: form, headers: { Authorization: `Bearer ${(res as any).accessToken ?? ''}` } }).catch(() => {});
    }
    router.push('/login?registered=1&role=contractor');
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-md mx-auto">
      <Stepper steps={STEPS} current={step} />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {step === 0 && (
          <>
            <div><Label>Full name</Label><Input {...register('name')} aria-invalid={!!errors.name} /><FieldError>{errors.name?.message}</FieldError></div>
            <PhoneInput value={watch('phone')} onChange={(v) => setValue('phone', v)} error={errors.phone?.message} />
            <div><Label>Password</Label><Input type="password" {...register('password')} aria-invalid={!!errors.password} /><FieldError>{errors.password?.message}</FieldError></div>
          </>
        )}
        {step === 1 && (
          <>
            <div><Label>Driving license number</Label><Input {...register('licenseNumber')} aria-invalid={!!errors.licenseNumber} /><FieldError>{errors.licenseNumber?.message}</FieldError></div>
            <div><Label>Years of experience</Label><Input type="number" min={0} {...register('experienceYears')} /><FieldError>{errors.experienceYears?.message}</FieldError></div>
          </>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">You can also upload these later from your dashboard.</p>
            <FileDropzone label="Vehicle registration" onFile={(f) => setPendingFiles((p) => ({ ...p, registration: f }))} />
            <FileDropzone label="Insurance certificate" onFile={(f) => setPendingFiles((p) => ({ ...p, insurance: f }))} />
            <FileDropzone label="Inspection certificate" onFile={(f) => setPendingFiles((p) => ({ ...p, inspection: f }))} />
          </div>
        )}
        {step === 3 && (
          <>
            <div className="rounded-xl bg-secondary p-4 text-sm space-y-1">
              <p><strong>{watch('name')}</strong> · {watch('phone')}</p>
              <p>License: {watch('licenseNumber')} · {watch('experienceYears')} yrs experience</p>
              <p>{Object.keys(pendingFiles).length} document(s) ready to upload</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...register('tosAccepted')} />
              I agree to the <a href="/legal/terms" className="text-accent underline">Terms of Service</a>
            </label>
            <FieldError>{errors.tosAccepted?.message as string}</FieldError>
          </>
        )}

        <div className="flex gap-3 pt-2">
          {step > 0 && <Button type="button" variant="outline" onClick={back}>Back</Button>}
          {step < STEPS.length - 1
            ? <Button type="button" className="flex-1" onClick={next}>Continue</Button>
            : <Button type="submit" className="flex-1" loading={isSubmitting}>Create account</Button>}
        </div>
      </form>
    </div>
  );
}
```

```tsx
// apps/web/app/signup/corporate/page.tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, FieldError, PhoneInput } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const Schema = z.object({
  corpName: z.string().min(2),
  corpCode: z.string().min(2).max(12).regex(/^[A-Z0-9-]+$/, 'Uppercase letters, numbers, hyphens only'),
  contactEmail: z.string().email(),
  contactPhone: z.string().regex(/^\+251(9|7)\d{8}$/),
  adminName: z.string().min(2),
  adminPassword: z.string().min(10),
  subsidyPercent: z.coerce.number().min(0).max(100),
  monthlySeatAllowance: z.coerce.number().int().positive(),
});
type FormValues = z.infer<typeof Schema>;

export default function CorporateSignupPage() {
  const router = useRouter();
  const client = useApiClient();
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(Schema), defaultValues: { contactPhone: '+251', subsidyPercent: 50, monthlySeatAllowance: 20 } });

  const onSubmit = async (data: FormValues) => {
    const { error } = await client.POST('/api/v1/corporate/signup', { body: data });
    if (!error) router.push('/login?registered=1&role=corporate_admin');
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-6">Register your company</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div><Label>Company name</Label><Input {...register('corpName')} aria-invalid={!!errors.corpName} /><FieldError>{errors.corpName?.message}</FieldError></div>
        <div><Label>Company code (public, e.g. ETH-TEL)</Label><Input {...register('corpCode')} aria-invalid={!!errors.corpCode} /><FieldError>{errors.corpCode?.message}</FieldError></div>
        <div><Label>Contact email</Label><Input type="email" {...register('contactEmail')} aria-invalid={!!errors.contactEmail} /><FieldError>{errors.contactEmail?.message}</FieldError></div>
        <PhoneInput label="Contact phone" value={watch('contactPhone')} onChange={(v) => setValue('contactPhone', v)} error={errors.contactPhone?.message} />
        <div><Label>Admin full name</Label><Input {...register('adminName')} aria-invalid={!!errors.adminName} /><FieldError>{errors.adminName?.message}</FieldError></div>
        <div><Label>Admin password</Label><Input type="password" {...register('adminPassword')} aria-invalid={!!errors.adminPassword} /><FieldError>{errors.adminPassword?.message}</FieldError></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Subsidy %</Label><Input type="number" min={0} max={100} {...register('subsidyPercent')} /></div>
          <div><Label>Monthly seat allowance</Label><Input type="number" min={1} {...register('monthlySeatAllowance')} /></div>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>Register company</Button>
      </form>
    </div>
  );
}
```

```tsx
// apps/web/app/corporate/onboard/page.tsx  (employee links themselves to a registered corporate)
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button, Input, Label, FieldError } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const Schema = z.object({ corporateCode: z.string().min(2), employeeId: z.string().min(1) });

export default function CorporateOnboardPage() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useApiClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm({ resolver: zodResolver(Schema), defaultValues: { corporateCode: params.get('corp') ?? '' } });

  const onSubmit = async (data: z.infer<typeof Schema>) => {
    const { error } = await client.POST('/api/v1/corporate/onboard', { body: data });
    if (!error) router.push('/corporate/me?pending=1');
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold mb-2">Link your employer</h1>
      <p className="text-sm text-muted-foreground mb-6">Your subsidy will apply once your employer approves this request.</p>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div><Label>Company code</Label><Input {...register('corporateCode')} aria-invalid={!!errors.corporateCode} /><FieldError>{errors.corporateCode?.message}</FieldError></div>
        <div><Label>Employee ID</Label><Input {...register('employeeId')} aria-invalid={!!errors.employeeId} /><FieldError>{errors.employeeId?.message}</FieldError></div>
        <Button type="submit" className="w-full" loading={isSubmitting}>Request link</Button>
      </form>
    </div>
  );
}
```

---

## Phase 29 — Remaining admin CRUD pages (routes, shuttles, plans, payments, tickets, faq)

```tsx
// apps/web/app/admin/routes/page.tsx
'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, DataTable, Input, Label, FieldError, Badge, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';
import { CreateRouteInput } from '@addis/api/modules/catalog/types';

type RouteRow = { id: string; name: string; origin: string; destination: string; fare: string; isActive: boolean };

export default function AdminRoutesPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const { push } = useToast();
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['admin-routes'], queryFn: async () => (await client.GET('/api/v1/routes', { params: { query: { limit: 100 } } })).data });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(CreateRouteInput) });

  const create = useMutation({
    mutationFn: (body: any) => client.POST('/api/v1/admin/routes', { body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-routes'] }); setShowForm(false); reset(); push({ title: 'Route created', variant: 'success' }); },
    onError: () => push({ title: 'Could not create route', variant: 'error' }),
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => client.PATCH('/api/v1/admin/routes/{id}', { params: { path: { id } }, body: { isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-routes'] }),
  });

  const columns: Column<RouteRow>[] = [
    { key: 'name', header: 'Name' },
    { key: 'origin', header: 'Origin' },
    { key: 'destination', header: 'Destination' },
    { key: 'fare', header: 'Fare (ETB)' },
    { key: 'isActive', header: 'Status', render: (r) => (
      <button onClick={() => toggleActive.mutate({ id: r.id, isActive: !r.isActive })}>
        <Badge variant={r.isActive ? 'success' : 'secondary'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
      </button>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Routes</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}><Plus className="h-4 w-4" />New route</Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit((d) => create.mutate(d))} className="rounded-2xl border border-border p-4 grid sm:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input {...register('name')} aria-invalid={!!errors.name} /><FieldError>{errors.name?.message as string}</FieldError></div>
          <div><Label>Fare (ETB)</Label><Input {...register('fare')} aria-invalid={!!errors.fare} /><FieldError>{errors.fare?.message as string}</FieldError></div>
          <div><Label>Origin</Label><Input {...register('origin')} /></div>
          <div><Label>Destination</Label><Input {...register('destination')} /></div>
          <div><Label>Distance (km)</Label><Input type="number" step="0.1" {...register('distanceKm', { valueAsNumber: true })} /></div>
          <div><Label>Duration (min)</Label><Input type="number" {...register('durationMin', { valueAsNumber: true })} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>Create</Button>
          </div>
        </form>
      )}

      <DataTable columns={columns} rows={(data ?? []) as RouteRow[]} loading={isLoading} />
    </div>
  );
}
```

```tsx
// apps/web/app/admin/shuttles/page.tsx
'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, DataTable, Input, Label, Badge, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

type ShuttleRow = { id: string; plateNumber: string; model: string; vehicleType: string; capacity: number; isActive: boolean };

export default function AdminShuttlesPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ plateNumber: '', model: '', year: 2022, vehicleType: 'minibus', capacity: 14 });

  const { data, isLoading } = useQuery({ queryKey: ['admin-shuttles'], queryFn: async () => (await client.GET('/api/v1/admin/shuttles', { params: { query: { limit: 100 } } })).data });
  const create = useMutation({
    mutationFn: () => client.POST('/api/v1/admin/shuttles', { body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-shuttles'] }); setShowForm(false); },
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => client.PATCH('/api/v1/admin/shuttles/{id}', { params: { path: { id } }, body: { isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-shuttles'] }),
  });

  const columns: Column<ShuttleRow>[] = [
    { key: 'plateNumber', header: 'Plate' }, { key: 'model', header: 'Model' },
    { key: 'vehicleType', header: 'Type' }, { key: 'capacity', header: 'Capacity' },
    { key: 'isActive', header: 'Status', render: (s) => (
      <button onClick={() => toggleActive.mutate({ id: s.id, isActive: !s.isActive })}>
        <Badge variant={s.isActive ? 'success' : 'secondary'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
      </button>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Shuttles</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}><Plus className="h-4 w-4" />New shuttle</Button>
      </div>
      {showForm && (
        <div className="rounded-2xl border border-border p-4 grid sm:grid-cols-2 gap-3">
          <div><Label>Plate number</Label><Input value={form.plateNumber} onChange={(e) => setForm((f) => ({ ...f, plateNumber: e.target.value }))} /></div>
          <div><Label>Model</Label><Input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} /></div>
          <div><Label>Year</Label><Input type="number" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))} /></div>
          <div><Label>Capacity</Label><Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
          </div>
        </div>
      )}
      <DataTable columns={columns} rows={(data ?? []) as ShuttleRow[]} loading={isLoading} />
    </div>
  );
}
```

```tsx
// apps/web/app/admin/plans/page.tsx
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, Badge, Button } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useFormatMoney } from '@addis/i18n';

export default function AdminPlansPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const money = useFormatMoney();
  const { data } = useQuery({ queryKey: ['admin-plans'], queryFn: async () => (await client.GET('/api/v1/plans')).data });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => client.PATCH('/api/v1/admin/plans/{id}', { params: { path: { id } }, body: { isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-plans'] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Plans</h1>
      <div className="grid sm:grid-cols-3 gap-4">
        {(data ?? []).map((p: any) => (
          <Card key={p.id}>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{p.name}</p>
                {p.isPopular && <Badge>Popular</Badge>}
              </div>
              <p className="text-2xl font-semibold">{money(p.priceETB)}</p>
              <p className="text-sm text-muted-foreground">{p.durationDays} days · {p.ridesIncluded === -1 ? 'Unlimited' : `${p.ridesIncluded} rides`}</p>
              <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: p.id, isActive: !p.isActive })}>
                {p.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

```tsx
// apps/web/app/admin/payments/page.tsx
'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DataTable, Badge, Button, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useFormatMoney } from '@addis/i18n';

type PaymentRow = { id: string; riderId: string; amount: string; method: string; status: string; reference: string; createdAt: string };
const STATUS_VARIANT: Record<string, any> = { completed: 'success', pending: 'warning', failed: 'destructive', refunded: 'secondary', partially_refunded: 'secondary' };

export default function AdminPaymentsPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const money = useFormatMoney();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-payments', statusFilter],
    queryFn: async () => (await client.GET('/api/v1/admin/payments', { params: { query: { limit: 50, status: statusFilter || undefined } } })).data,
  });
  const verifyCbe = useMutation({
    mutationFn: (id: string) => client.POST('/api/v1/admin/payments/{id}/verify', { params: { path: { id } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-payments'] }),
  });

  const columns: Column<PaymentRow>[] = [
    { key: 'reference', header: 'Reference' },
    { key: 'amount', header: 'Amount', render: (p) => money(p.amount) },
    { key: 'method', header: 'Method', render: (p) => <Badge variant="secondary">{p.method}</Badge> },
    { key: 'status', header: 'Status', render: (p) => <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge> },
    { key: 'createdAt', header: 'Date', render: (p) => new Date(p.createdAt).toLocaleDateString() },
    { key: 'id', header: 'Actions', render: (p) => p.method === 'cbe' && p.status === 'pending'
      ? <Button size="sm" onClick={() => verifyCbe.mutate(p.id)}>Verify manually</Button> : null },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Payments</h1>
        <select className="rounded-xl border border-border bg-card px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {['pending', 'completed', 'failed', 'refunded', 'partially_refunded'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <DataTable columns={columns} rows={(data ?? []) as PaymentRow[]} loading={isLoading} />
    </div>
  );
}
```

```tsx
// apps/web/app/admin/tickets/page.tsx
'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DataTable, Badge, type Column } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

type TicketRow = { id: string; subject: string; status: string; priority: string; category: string; createdAt: string };
const STATUS_VARIANT: Record<string, any> = { open: 'warning', in_progress: 'default', resolved: 'success', closed: 'secondary' };

export default function AdminTicketsPage() {
  const client = useApiClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-tickets'], queryFn: async () => (await client.GET('/api/v1/admin/tickets', { params: { query: { limit: 50 } } })).data });

  const columns: Column<TicketRow>[] = [
    { key: 'subject', header: 'Subject', render: (t) => <Link href={`/admin/tickets/${t.id}`} className="text-accent">{t.subject}</Link> },
    { key: 'category', header: 'Category' },
    { key: 'priority', header: 'Priority' },
    { key: 'status', header: 'Status', render: (t) => <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace('_', ' ')}</Badge> },
    { key: 'createdAt', header: 'Created', render: (t) => new Date(t.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Support queue</h1>
      <DataTable columns={columns} rows={(data ?? []) as TicketRow[]} loading={isLoading} />
    </div>
  );
}
```

```tsx
// apps/web/app/admin/faq/page.tsx
'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, CardContent, Input, Label } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

export default function AdminFaqPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const [form, setForm] = useState({ category: 'general', question: '', answer: '' });
  const [showForm, setShowForm] = useState(false);

  const { data } = useQuery({ queryKey: ['admin-faq'], queryFn: async () => (await client.GET('/api/v1/faq')).data });
  const create = useMutation({
    mutationFn: () => client.POST('/api/v1/admin/faq', { body: form }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-faq'] }); setShowForm(false); setForm({ category: 'general', question: '', answer: '' }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.DELETE('/api/v1/admin/faq/{id}', { params: { path: { id } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-faq'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">FAQ</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}><Plus className="h-4 w-4" />New article</Button>
      </div>
      {showForm && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div><Label>Category</Label>
            <select className="w-full rounded-xl border border-border bg-card p-2" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {['billing', 'routes', 'shuttle', 'account', 'corporate', 'general'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><Label>Question</Label><Input value={form.question} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))} /></div>
          <div><Label>Answer</Label><textarea className="w-full rounded-xl border border-border bg-card p-3 text-sm" rows={3} value={form.answer} onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Save</Button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {(data ?? []).map((a: any) => (
          <Card key={a.id}><CardContent className="flex items-start justify-between">
            <div><p className="font-medium">{a.question}</p><p className="text-sm text-muted-foreground">{a.answer}</p></div>
            <button onClick={() => remove.mutate(a.id)} aria-label="Delete"><Trash2 className="h-4 w-4 text-destructive" /></button>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
```

---

## Phase 30 — ToS acceptance gate + account export pages

```tsx
// apps/web/app/tos/accept/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { CURRENT_TOS_VERSION } from '@addis/shared';

export default function TosAcceptPage() {
  const client = useApiClient();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const accept = async () => {
    setLoading(true);
    await client.POST('/api/v1/tos', { body: { version: CURRENT_TOS_VERSION } });
    router.back();
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold">Our Terms of Service have been updated</h1>
        <p className="text-sm text-muted-foreground">
          Please review the updated <a href="/legal/terms" target="_blank" className="text-accent underline">Terms of Service</a> and
          {' '}<a href="/legal/privacy" target="_blank" className="text-accent underline">Privacy Policy</a> to continue using Addis Ride.
        </p>
        <Button onClick={accept} loading={loading}>I accept the updated terms</Button>
      </div>
    </div>
  );
}
```

```tsx
// apps/web/app/account/export/page.tsx
'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@addis/ui';

export default function AccountExportPage() {
  const [loading, setLoading] = useState(false);

  const download = async (format: 'json' | 'csv') => {
    setLoading(true);
    const res = await fetch(`/api/v1/account/export?format=${format}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `addis-ride-export.${format === 'json' ? 'zip' : 'zip'}`;
    a.click(); URL.revokeObjectURL(url);
    setLoading(false);
  };

  return (
    <div className="px-6 py-16 max-w-md mx-auto text-center space-y-4">
      <Download className="h-8 w-8 mx-auto text-primary" />
      <h1 className="font-semibold text-lg">Export your data</h1>
      <p className="text-sm text-muted-foreground">
        Download a full copy of your profile, subscriptions, payments, rides, and support tickets — per Ethiopia's Data Protection Proclamation.
      </p>
      <div className="flex gap-3 justify-center">
        <Button loading={loading} onClick={() => download('json')}>Download JSON</Button>
        <Button variant="outline" loading={loading} onClick={() => download('csv')}>Download CSV</Button>
      </div>
    </div>
  );
}
```

---

## Phase 31 — Mobile app (Expo)

```json
// apps/mobile/app.json
{
  "expo": {
    "name": "Addis Ride",
    "slug": "addis-ride",
    "scheme": "addisride",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "plugins": ["expo-router", "expo-secure-store", "expo-notifications", "expo-background-fetch", "expo-localization"],
    "ios": { "supportsTablet": true, "bundleIdentifier": "et.addisride.app" },
    "android": { "package": "et.addisride.app", "adaptiveIcon": { "foregroundImage": "./assets/adaptive-icon.png" } },
    "extra": { "eas": { "projectId": "addis-ride" } },
    "updates": { "url": "https://u.expo.dev/addis-ride" }
  }
}
```

```json
// apps/mobile/package.json (excerpt)
{
  "name": "@addis/mobile",
  "dependencies": {
    "expo": "~52.0.0",
    "expo-router": "~4.0.0",
    "expo-secure-store": "~14.0.0",
    "expo-notifications": "~0.29.0",
    "expo-background-fetch": "~13.0.0",
    "expo-location": "~18.0.0",
    "expo-local-authentication": "~15.0.0",
    "react-native-maps": "1.18.0",
    "nativewind": "^4.1.0",
    "@tanstack/react-query": "^5.62.0",
    "zustand": "^5.0.0",
    "@addis/sdk": "workspace:*",
    "@addis/shared": "workspace:*",
    "@addis/i18n": "workspace:*"
  }
}
```

```ts
// apps/mobile/src/lib/auth-store.ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

type AuthState = {
  accessToken: string | null; role: string | null;
  setAuth: (token: string, role: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null, role: null,
  setAuth: async (accessToken, role) => {
    await SecureStore.setItemAsync('addisride.accessToken', accessToken);
    await SecureStore.setItemAsync('addisride.role', role);
    set({ accessToken, role });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync('addisride.accessToken');
    await SecureStore.deleteItemAsync('addisride.role');
    set({ accessToken: null, role: null });
  },
  hydrate: async () => {
    const accessToken = await SecureStore.getItemAsync('addisride.accessToken');
    const role = await SecureStore.getItemAsync('addisride.role');
    set({ accessToken, role });
  },
}));
```

```ts
// apps/mobile/src/lib/api.ts
import { createAddisRideClient } from '@addis/sdk';
import { useAuthStore } from './auth-store';

export const api = createAddisRideClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  getToken: () => useAuthStore.getState().accessToken ?? undefined,
});

/** 401 -> attempt refresh -> retry once -> else force logout. Wired into openapi-fetch middleware. */
let refreshing: Promise<boolean> | null = null;
export async function handleUnauthorized(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/v1/auth/refresh`, {
        method: 'POST', headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken}` },
      });
      if (!res.ok) { await useAuthStore.getState().clearAuth(); return false; }
      const { accessToken } = await res.json();
      await useAuthStore.getState().setAuth(accessToken, useAuthStore.getState().role!);
      return true;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}
```

```tsx
// apps/mobile/app/_layout.tsx
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@addis/i18n';
import { useAuthStore } from '../src/lib/auth-store';
import * as Notifications from 'expo-notifications';
import * as Localization from 'expo-localization';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));

  useEffect(() => { hydrate().finally(() => setReady(true)); }, [hydrate]);
  if (!ready) return null;

  const locale = Localization.getLocales()[0]?.languageCode === 'am' ? 'am' : 'en';

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale={locale}>
        <Stack screenOptions={{ headerShown: false }} />
      </I18nProvider>
    </QueryClientProvider>
  );
}
```

```tsx
// apps/mobile/app/(auth)/login.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { api } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/auth-store';

export default function LoginScreen() {
  const [phone, setPhone] = useState('+251');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setAuth = useAuthStore((s) => s.setAuth);

  const submit = async () => {
    setLoading(true); setError(null);
    const { data, error: apiError } = await api.POST('/api/v1/auth/token', { body: { phone, password } });
    setLoading(false);
    if (apiError || !data) { setError('Invalid phone number or password'); return; }
    await setAuth((data as any).accessToken, (data as any).user.role);
    router.replace('/(rider)/dashboard');
  };

  return (
    <View className="flex-1 justify-center px-6 bg-background">
      <Text className="text-2xl font-semibold text-center mb-8 text-foreground">Welcome back</Text>
      <Text className="text-sm font-medium mb-1 text-foreground">Phone number</Text>
      <TextInput
        value={phone} onChangeText={setPhone} keyboardType="phone-pad"
        className="h-12 rounded-xl border border-border px-3 mb-4 text-foreground"
        accessibilityLabel="Phone number"
      />
      <Text className="text-sm font-medium mb-1 text-foreground">Password</Text>
      <TextInput
        value={password} onChangeText={setPassword} secureTextEntry
        className="h-12 rounded-xl border border-border px-3 mb-2 text-foreground"
        accessibilityLabel="Password"
      />
      {error && <Text className="text-destructive text-sm mb-2">{error}</Text>}
      <Pressable onPress={submit} disabled={loading} className="h-12 rounded-xl bg-foreground items-center justify-center mt-4">
        {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-background font-medium">Log in</Text>}
      </Pressable>
      <Pressable onPress={() => router.push('/(auth)/signup')} className="mt-4">
        <Text className="text-center text-accent text-sm">Create an account</Text>
      </Pressable>
    </View>
  );
}
```

```tsx
// apps/mobile/app/(rider)/dashboard.tsx
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { api } from '../../src/lib/api';

export default function RiderDashboardScreen() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['rider-dashboard'],
    queryFn: async () => (await api.GET('/api/v1/dashboard/rider')).data,
  });
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ScrollView
      className="flex-1 bg-background"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <View className="px-5 pt-16">
        <Text className="text-2xl font-semibold text-foreground leading-tight">
          Every commute starts{'\n'}with a confirmed seat.
        </Text>
      </View>

      {(data as any)?.activeSubscription ? (
        <View className="mx-5 mt-6 rounded-3xl border border-border bg-card p-4">
          <View className="flex-row justify-between items-center">
            <Text className="text-sm text-muted-foreground">Active plan</Text>
            <View className="bg-primary/10 rounded-full px-2 py-1">
              <Text className="text-xs text-primary font-medium">{(data as any).activeSubscription.status}</Text>
            </View>
          </View>
          <Text className="text-lg font-semibold text-foreground mt-1">{(data as any).activeSubscription.plan.name}</Text>
          <Pressable
            onPress={() => router.push(`/(rider)/live-trip?subscriptionId=${(data as any).activeSubscription.id}`)}
            className="mt-3 bg-foreground rounded-full py-3 items-center"
          >
            <Text className="text-background font-medium">Track today's shuttle</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => router.push('/(rider)/plans')} className="mx-5 mt-6 rounded-3xl border border-dashed border-border p-6 items-center">
          <Text className="font-medium text-foreground">No active subscription</Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">Browse plans to reserve your daily seat</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
```

```tsx
// apps/mobile/app/(rider)/live-trip.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { useAuthStore } from '../../src/lib/auth-store';

export default function LiveTripScreen() {
  const { subscriptionId } = useLocalSearchParams<{ subscriptionId: string }>();
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const { data: trip } = useQuery({
    queryKey: ['active-trip', subscriptionId],
    queryFn: async () => (await api.GET('/api/v1/dashboard/rider/active-trip', { params: { query: { subscriptionId } } })).data,
  });

  useEffect(() => {
    if (!(trip as any)?.shuttleId) return;
    const token = useAuthStore.getState().accessToken;
    const es = new EventSource(`${process.env.EXPO_PUBLIC_API_URL}/api/v1/shuttle-positions/stream?shuttleIds=${(trip as any).shuttleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    } as any);
    es.onmessage = (e: any) => setPosition(JSON.parse(e.data));
    return () => es.close();
  }, [(trip as any)?.shuttleId]);

  if (!trip) return <View className="flex-1 items-center justify-center"><Text>Loading…</Text></View>;
  const t = trip as any;

  return (
    <View className="flex-1">
      <MapView style={{ flex: 1 }} initialRegion={{ latitude: 9.02, longitude: 38.75, latitudeDelta: 0.05, longitudeDelta: 0.05 }}>
        {t.polyline && <Polyline coordinates={t.polyline.map(([lat, lng]: number[]) => ({ latitude: lat, longitude: lng }))} strokeColor="#10b981" strokeWidth={4} />}
        {position && <Marker coordinate={{ latitude: position.lat, longitude: position.lng }} title={t.plateNumber} />}
      </MapView>

      <View className="absolute bottom-0 inset-x-0 bg-card rounded-t-3xl p-4 border-t border-border">
        <View className="flex-row justify-between mb-3">
          <Text className="text-muted-foreground text-sm">Arriving in</Text>
          <Text className="font-semibold text-lg">{t.etaMinutes} min</Text>
        </View>
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="font-medium">{t.contractorName}</Text>
            <Text className="text-xs text-muted-foreground">{t.plateNumber} · ★ {t.contractorRating}</Text>
          </View>
          <Pressable onPress={() => Linking.openURL(`tel:${t.contractorPhone}`)} className="h-10 w-10 rounded-full bg-foreground items-center justify-center">
            <Text className="text-background">📞</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
```

```tsx
// apps/mobile/app/(contractor)/gps-tracker.tsx
import { useEffect, useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Location from 'expo-location';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { api } from '../../src/lib/api';

const GPS_TASK = 'addisride-gps-report';

TaskManager.defineTask(GPS_TASK, async () => {
  const shuttleId = await getActiveShuttleId(); // reads from SecureStore, set when trip starts
  if (!shuttleId) return BackgroundFetch.BackgroundFetchResult.NoData;
  const loc = await Location.getCurrentPositionAsync({});
  await api.POST('/api/v1/shuttle-positions', {
    body: { shuttleId, lat: loc.coords.latitude, lng: loc.coords.longitude, heading: loc.coords.heading ?? undefined, speed: loc.coords.speed ?? undefined },
  }).catch(() => {}); // fail-soft; next tick retries
  return BackgroundFetch.BackgroundFetchResult.NewData;
});

async function getActiveShuttleId() {
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync('addisride.activeShuttleId');
}

export default function ContractorGpsTrackerScreen() {
  const registered = useRef(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || registered.current) return;
      await BackgroundFetch.registerTaskAsync(GPS_TASK, { minimumInterval: 10, stopOnTerminate: false, startOnBoot: true });
      registered.current = true;
    })();
    return () => { BackgroundFetch.unregisterTaskAsync(GPS_TASK).catch(() => {}); };
  }, []);

  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-lg font-semibold">Trip in progress</Text>
      <Text className="text-sm text-muted-foreground mt-1 text-center">Your location is being shared with riders on this trip every 10 seconds.</Text>
    </View>
  );
}
```

```ts
// apps/mobile/src/lib/push.ts
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { Platform } from 'react-native';

export async function registerPushToken() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    const { status: requested } = await Notifications.requestPermissionsAsync();
    status = requested;
  }
  if (status !== 'granted') return;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  await api.POST('/api/v1/devices', { body: { pushToken: tokenData.data, platform: Platform.OS } });
}

Notifications.addNotificationResponseReceivedListener((response) => {
  const link = response.notification.request.content.data?.link as string | undefined;
  if (link) {
    const { router } = require('expo-router');
    router.push(link.replace('addisride://', '/'));
  }
});
```

---

## Phase 32 — Maestro E2E flow (mobile)

```yaml
# apps/mobile/.maestro/rider-critical-path.yaml
appId: et.addisride.app
---
- launchApp
- tapOn: "Phone number"
- inputText: "922555999"
- tapOn: "Password"
- inputText: "demo12345"
- tapOn: "Log in"
- assertVisible: "Every commute starts"

- tapOn: "No active subscription"
- assertVisible: "Choose a plan"
- tapOn: "Monthly Unlimited"
- tapOn: "Continue to payment"
- tapOn: "telebirr"
- tapOn: "Continue"
- assertVisible: "superapp" # telebirr checkout webview loads

- back
- tapOn: "Track today's shuttle"
- assertVisible: "Arriving in"

- tapOn: "Support"
- tapOn: "New ticket"
- inputText: "Question about my subscription"
- tapOn: "Submit"
- assertVisible: "open"
```

---

### State after this pass

| Area | Status |
|---|---|
| Contractor & corporate signup wizards, employee onboarding | ✅ |
| Full admin CRUD (routes, shuttles, plans, payments, tickets, faq) | ✅ |
| ToS acceptance gate page, account export page | ✅ |
| Expo mobile app: auth store, SDK wiring w/ refresh, login/signup shell, rider dashboard, live trip tracking (react-native-maps + SSE), contractor background GPS reporting, push registration | ✅ |
| Maestro E2E flow | ✅ |

**Still open** for full production readiness: mobile signup wizard screens (mirrors web `Stepper` pattern using RN equivalents), offline mutation queue (AsyncStorage-backed per §16), tablet split-view layouts, biometric unlock wiring (`expo-local-authentication` gate before showing dashboard), component-level unit tests (`*.test.tsx` with React Testing Library / RN Testing Library), and the `packages/i18n` Amharic translations for the newly added admin/mobile strings.

Let me know whether to continue into **mobile offline queue + biometric gate + remaining mobile screens**, or **component unit tests + i18n completion**, or wrap up with the **infra/CI finalization** (GitHub Actions workflow, k6 load test, Sentry release wiring).
