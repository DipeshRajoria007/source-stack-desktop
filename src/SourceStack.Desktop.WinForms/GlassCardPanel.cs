using System.Drawing.Drawing2D;

namespace SourceStack.Desktop.WinForms;

internal sealed class GlassCardPanel : Panel
{
    private int _cornerRadius = 14;

    public int CornerRadius
    {
        get => _cornerRadius;
        set
        {
            _cornerRadius = Math.Max(4, value);
            UpdateRegion();
            Invalidate();
        }
    }

    public Color FillColor { get; set; } = Color.FromArgb(190, 24, 28, 34);
    public Color BorderColor { get; set; } = Color.FromArgb(80, 255, 255, 255);
    public int BorderWidth { get; set; } = 1;

    public GlassCardPanel()
    {
        BackColor = Color.Transparent;
        DoubleBuffered = true;
        Padding = new Padding(16);
        Resize += (_, _) => UpdateRegion();
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        base.OnPaintBackground(e);

        if (ClientRectangle.Width <= 0 || ClientRectangle.Height <= 0)
        {
            return;
        }

        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

        var rect = new Rectangle(0, 0, ClientRectangle.Width - 1, ClientRectangle.Height - 1);
        using var path = CreateRoundedRectangle(rect, CornerRadius);
        using var fillBrush = new SolidBrush(FillColor);
        using var borderPen = new Pen(BorderColor, BorderWidth);

        e.Graphics.FillPath(fillBrush, path);
        e.Graphics.DrawPath(borderPen, path);
    }

    private void UpdateRegion()
    {
        if (ClientRectangle.Width <= 0 || ClientRectangle.Height <= 0)
        {
            return;
        }

        using var path = CreateRoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), CornerRadius);
        var oldRegion = Region;
        Region = new Region(path);
        oldRegion?.Dispose();
    }

    private static GraphicsPath CreateRoundedRectangle(Rectangle rect, int radius)
    {
        var diameter = radius * 2;
        var path = new GraphicsPath();

        if (diameter > rect.Width)
        {
            diameter = rect.Width;
        }

        if (diameter > rect.Height)
        {
            diameter = rect.Height;
        }

        var arc = new Rectangle(rect.Location, new Size(diameter, diameter));
        path.AddArc(arc, 180, 90);

        arc.X = rect.Right - diameter;
        path.AddArc(arc, 270, 90);

        arc.Y = rect.Bottom - diameter;
        path.AddArc(arc, 0, 90);

        arc.X = rect.Left;
        path.AddArc(arc, 90, 90);

        path.CloseFigure();
        return path;
    }
}
