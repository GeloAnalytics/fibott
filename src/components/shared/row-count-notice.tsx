export function RowCountNotice({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Showing {shown} of {total}. Narrow your search to see more specific results.
    </p>
  );
}
