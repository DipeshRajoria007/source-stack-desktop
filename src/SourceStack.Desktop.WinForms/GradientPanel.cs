using System.Drawing.Drawing2D;

namespace SourceStack.Desktop.WinForms;

internal sealed class GradientPanel : Panel
{
    public Color StartColor { get; set; } = Color.FromArgb(15, 15, 16);
    public Color EndColor { get; set; } = Color.FromArgb(34, 34, 36);
    public Color BlobColorA { get; set; } = Color.FromArgb(38, 88, 114, 140);
    public Color BlobColorB { get; set; } = Color.FromArgb(34, 110, 128, 152);
    public Color BlobColorC { get; set; } = Color.FromArgb(26, 160, 180, 210);

    private static readonly PointF[] StarPoints =
    [
        new PointF(0.20f, 0.30f), new PointF(0.60f, 0.70f), new PointF(0.50f, 0.50f), new PointF(0.80f, 0.10f), new PointF(0.90f, 0.60f),
        new PointF(0.33f, 0.80f), new PointF(0.10f, 0.40f), new PointF(0.70f, 0.20f), new PointF(0.40f, 0.90f), new PointF(0.15f, 0.60f),
        new PointF(0.75f, 0.30f), new PointF(0.55f, 0.15f), new PointF(0.25f, 0.70f), new PointF(0.85f, 0.50f), new PointF(0.45f, 0.25f),
        new PointF(0.65f, 0.85f), new PointF(0.30f, 0.10f), new PointF(0.95f, 0.75f), new PointF(0.05f, 0.55f), new PointF(0.50f, 0.95f),
        new PointF(0.12f, 0.25f), new PointF(0.35f, 0.45f), new PointF(0.68f, 0.65f), new PointF(0.88f, 0.35f), new PointF(0.22f, 0.88f),
        new PointF(0.78f, 0.12f), new PointF(0.42f, 0.72f), new PointF(0.92f, 0.82f), new PointF(0.18f, 0.52f), new PointF(0.58f, 0.28f),
    ];

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        if (ClientRectangle.Width <= 0 || ClientRectangle.Height <= 0)
        {
            return;
        }

        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

        using (var brush = new LinearGradientBrush(ClientRectangle, StartColor, EndColor, 90f))
        {
            e.Graphics.FillRectangle(brush, ClientRectangle);
        }

        DrawBlob(e.Graphics, BlobColorA, new Rectangle((int)(Width * 0.02f), (int)(Height * 0.10f), (int)(Width * 0.34f), (int)(Height * 0.38f)));
        DrawBlob(e.Graphics, BlobColorB, new Rectangle((int)(Width * 0.58f), (int)(Height * 0.50f), (int)(Width * 0.34f), (int)(Height * 0.38f)));
        DrawBlob(e.Graphics, BlobColorC, new Rectangle((int)(Width * 0.25f), (int)(Height * 0.22f), (int)(Width * 0.46f), (int)(Height * 0.56f)));

        using var starBrush = new SolidBrush(Color.FromArgb(172, 235, 241, 250));
        for (var i = 0; i < StarPoints.Length; i++)
        {
            var point = StarPoints[i];
            var x = point.X * Width;
            var y = point.Y * Height;
            var size = i % 3 == 0 ? 2.2f : 1.4f;
            e.Graphics.FillEllipse(starBrush, x, y, size, size);
        }
    }

    private static void DrawBlob(Graphics graphics, Color color, Rectangle bounds)
    {
        using var brush = new PathGradientBrush(new[]
        {
            bounds.Location,
            new Point(bounds.Right, bounds.Top),
            new Point(bounds.Right, bounds.Bottom),
            new Point(bounds.Left, bounds.Bottom),
        })
        {
            CenterColor = color,
            SurroundColors = [Color.FromArgb(0, color.R, color.G, color.B)],
            FocusScales = new PointF(0.5f, 0.5f),
        };

        graphics.FillEllipse(brush, bounds);
    }
}
