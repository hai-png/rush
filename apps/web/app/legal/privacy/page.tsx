import { DPO_CONTACT } from '@addis/shared';
export default function PrivacyPage() {
  return (
    <article className="prose dark:prose-invert max-w-2xl mx-auto px-6 py-16">
      <h1>Privacy Policy</h1>
      <p>Addis Ride complies with Ethiopia's Data Protection Proclamation 1321/2024.</p>
      <p>Data Protection Officer contact: <a href={`mailto:${DPO_CONTACT}`}>{DPO_CONTACT}</a></p>
    </article>
  );
}
