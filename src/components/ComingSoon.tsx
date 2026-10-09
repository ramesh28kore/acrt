export function ComingSoonGrid({ items }: { items: { title: string; text: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <div key={i.title} className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg text-card-foreground">{i.title}</h3>
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">Coming soon</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{i.text}</p>
        </div>
      ))}
    </div>
  );
}
