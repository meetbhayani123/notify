import "./globals.css";

export const metadata = {
  title: "Cricket Alert Manager — Series Dashboard",
  description: "Manage cricket tournament notifications. Mute or unmute series to control which matches trigger alerts.",
  keywords: ["cricket", "notifications", "series", "tournament", "alerts"],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div id="app-root">{children}</div>
      </body>
    </html>
  );
}
