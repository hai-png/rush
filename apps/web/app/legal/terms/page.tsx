export default function TermsPage() {
  return (
    <article className="prose dark:prose-invert max-w-2xl mx-auto px-6 py-16">
      <h1>Terms of Service</h1>
      <p>Version 2.0 — effective {new Date().toLocaleDateString()}</p>
      <p>These Terms govern your use of Addis Ride's subscription shuttle platform...</p>
      {/* Full legal text maintained by DPO/legal team, versioned against CURRENT_TOS_VERSION */}
    </article>
  );
}
