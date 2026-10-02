// Signing out lands here: no app header, just the sign-in backdrop.
export default function Loading() {
  return <main className="ruled min-h-dvh" aria-busy="true" aria-label="Loading" />;
}
