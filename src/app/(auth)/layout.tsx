export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-1 items-center justify-center bg-secondary/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
            Fibott
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Recycle bottles and cans for WiFi vouchers
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
