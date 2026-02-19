using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using SourceStack.Core.Adapters;
using SourceStack.Core.Models;
using SourceStack.Core.Options;
using SourceStack.Core.Parsing;

namespace SourceStack.Desktop.WinForms;

internal sealed class MainForm : Form
{
    private readonly DesktopSettings _settings;

    private ResumeProcessingController? _controller;

    private Label _statusLabel = null!;
    private ProgressBar _jobProgress = null!;
    private Label _jobMetaLabel = null!;

    private TextBox _filePathInput = null!;
    private TextBox _nameOutput = null!;
    private TextBox _emailOutput = null!;
    private TextBox _phoneOutput = null!;
    private TextBox _linkedInOutput = null!;
    private TextBox _gitHubOutput = null!;
    private TextBox _confidenceOutput = null!;
    private TextBox _errorsOutput = null!;

    private TextBox _driveFolderIdInput = null!;
    private TextBox _spreadsheetIdInput = null!;
    private Label _jobIdLabel = null!;

    private ListView _statusSteps = null!;
    private ListBox _jobsList = null!;
    private ListBox _jobsHistoryList = null!;

    private TextBox _googleClientIdInput = null!;
    private TextBox _googleClientSecretInput = null!;
    private TextBox _tesseractPathInput = null!;
    private NumericUpDown _maxConcurrencyInput = null!;
    private NumericUpDown _batchSizeInput = null!;
    private NumericUpDown _maxRetriesInput = null!;
    private NumericUpDown _retryDelayInput = null!;

    private TabControl _workspaceTabs = null!;
    private Button _dashboardNavButton = null!;
    private Button _jobsNavButton = null!;
    private Button _settingsNavButton = null!;

    private string? _activeJobId;
    private readonly System.Windows.Forms.Timer _jobPollTimer;

    public MainForm()
    {
        _settings = SettingsStore.Load();

        Text = "SourceStack Desktop";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1180, 760);
        Width = 1320;
        Height = 880;
        Font = new Font("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);

        _jobPollTimer = new System.Windows.Forms.Timer
        {
            Interval = 2000,
        };
        _jobPollTimer.Tick += async (_, _) => await PollJobStatusAsync();

        BuildLayout();
        ApplySettingsToInputs();
        RebuildController();
        SyncSidebarSelection();
    }

    private void BuildLayout()
    {
        var root = new GradientPanel
        {
            Dock = DockStyle.Fill,
            StartColor = Color.FromArgb(8, 11, 18),
            EndColor = Color.FromArgb(20, 26, 36),
            Padding = new Padding(0),
        };
        Controls.Add(root);

        var shell = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            BackColor = Color.Transparent,
        };

        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));

        root.Controls.Add(shell);

        var topBar = BuildTopBar();
        shell.Controls.Add(topBar, 0, 0);

        var body = new SplitContainer
        {
            Dock = DockStyle.Fill,
            IsSplitterFixed = false,
            FixedPanel = FixedPanel.Panel1,
            SplitterDistance = 265,
            Panel1MinSize = 245,
            Panel2MinSize = 760,
            BorderStyle = BorderStyle.None,
            BackColor = Color.Transparent,
        };

        shell.Controls.Add(body, 0, 1);

        BuildSidebar(body.Panel1);
        BuildMainContent(body.Panel2);

        var statusPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(120, 14, 18, 26),
            Padding = new Padding(14, 4, 14, 4),
        };

        _statusLabel = new Label
        {
            Text = "Ready",
            ForeColor = Color.Gainsboro,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            Font = new Font("Segoe UI", 9f),
        };

        statusPanel.Controls.Add(_statusLabel);
        shell.Controls.Add(statusPanel, 0, 2);
    }

    private Control BuildTopBar()
    {
        var topCard = new GlassCardPanel
        {
            Dock = DockStyle.Fill,
            Margin = new Padding(12, 10, 12, 6),
            Padding = new Padding(18, 10, 18, 10),
            FillColor = Color.FromArgb(132, 14, 22, 32),
            BorderColor = Color.FromArgb(80, 255, 255, 255),
            CornerRadius = 12,
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 3,
            RowCount = 1,
            BackColor = Color.Transparent,
        };

        layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var titlePanel = new Panel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            BackColor = Color.Transparent,
            Padding = new Padding(0),
        };

        var title = new Label
        {
            Text = "SourceStack Desktop",
            ForeColor = Color.WhiteSmoke,
            Font = new Font("Segoe UI Semibold", 13f, FontStyle.Bold),
            Dock = DockStyle.Top,
            Height = 28,
        };

        var subtitle = new Label
        {
            Text = "Resume intelligence pipeline running on your machine",
            ForeColor = Color.FromArgb(208, 214, 224),
            Font = new Font("Segoe UI", 9f, FontStyle.Regular),
            Dock = DockStyle.Top,
            Height = 22,
        };

        titlePanel.Controls.Add(subtitle);
        titlePanel.Controls.Add(title);

        var pillHost = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
            Padding = new Padding(14, 8, 0, 0),
        };

        var modePill = CreatePillLabel("LOCAL CORE • NO SERVER", Color.FromArgb(48, 123, 196, 249), Color.FromArgb(236, 246, 255));
        modePill.Dock = DockStyle.Left;
        pillHost.Controls.Add(modePill);

        var actions = new FlowLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = Color.Transparent,
            Padding = new Padding(0, 4, 0, 0),
        };

        var openJobsButton = CreateTopBarButton("Jobs Folder");
        openJobsButton.Click += (_, _) => OpenJobsDirectory();

        var openSettingsButton = CreateTopBarButton("Settings File");
        openSettingsButton.Click += (_, _) => OpenSettingsFile();

        var refreshJobsButton = CreateTopBarButton("Refresh Jobs");
        refreshJobsButton.Click += async (_, _) => await RefreshJobsAsync();

        actions.Controls.Add(openJobsButton);
        actions.Controls.Add(openSettingsButton);
        actions.Controls.Add(refreshJobsButton);

        layout.Controls.Add(titlePanel, 0, 0);
        layout.Controls.Add(pillHost, 1, 0);
        layout.Controls.Add(actions, 2, 0);

        topCard.Controls.Add(layout);
        return topCard;
    }

    private void BuildSidebar(Control container)
    {
        container.BackColor = Color.Transparent;

        var sidebar = new GlassCardPanel
        {
            Dock = DockStyle.Fill,
            Margin = new Padding(12, 0, 8, 12),
            Padding = new Padding(14),
            FillColor = Color.FromArgb(148, 10, 14, 22),
            BorderColor = Color.FromArgb(66, 255, 255, 255),
            CornerRadius = 14,
        };

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            BackColor = Color.Transparent,
        };

        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 86));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 212));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 114));

        var brand = new Label
        {
            Text = "SOURCESTACK",
            ForeColor = Color.WhiteSmoke,
            Font = new Font("Segoe UI Semibold", 18f, FontStyle.Bold),
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.BottomLeft,
        };

        var subBrand = new Label
        {
            Text = "Desktop workspace",
            ForeColor = Color.Gainsboro,
            Font = new Font("Segoe UI", 9f),
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.TopLeft,
        };

        var navPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            BackColor = Color.Transparent,
            Margin = new Padding(0),
            Padding = new Padding(0, 8, 0, 0),
        };

        _dashboardNavButton = CreateSidebarNavButton("Dashboard", "Parse and run batch jobs", 0);
        _jobsNavButton = CreateSidebarNavButton("Jobs", "Track status and history", 1);
        _settingsNavButton = CreateSidebarNavButton("Settings", "Google OAuth and runtime", 2);

        navPanel.Controls.Add(_dashboardNavButton);
        navPanel.Controls.Add(_jobsNavButton);
        navPanel.Controls.Add(_settingsNavButton);

        var spacer = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
        };

        var infoCard = new GlassCardPanel
        {
            Dock = DockStyle.Fill,
            Margin = new Padding(0),
            Padding = new Padding(12),
            FillColor = Color.FromArgb(120, 32, 42, 58),
            BorderColor = Color.FromArgb(66, 199, 214, 245),
            CornerRadius = 12,
        };

        var infoTitle = new Label
        {
            Text = "Runtime",
            ForeColor = Color.FromArgb(236, 244, 255),
            Dock = DockStyle.Top,
            Height = 22,
            Font = new Font("Segoe UI Semibold", 10f, FontStyle.Bold),
        };

        var infoText = new Label
        {
            Text = "Computation, job queue, OCR, and storage stay local. Only Google APIs are called.",
            ForeColor = Color.FromArgb(215, 227, 243),
            Dock = DockStyle.Fill,
            Font = new Font("Segoe UI", 8.4f),
        };

        infoCard.Controls.Add(infoText);
        infoCard.Controls.Add(infoTitle);

        root.Controls.Add(brand, 0, 0);
        root.Controls.Add(subBrand, 0, 1);
        root.Controls.Add(navPanel, 0, 2);
        root.Controls.Add(spacer, 0, 3);
        root.Controls.Add(infoCard, 0, 4);

        sidebar.Controls.Add(root);
        container.Controls.Add(sidebar);
    }

    private void BuildMainContent(Control container)
    {
        container.BackColor = Color.Transparent;

        _workspaceTabs = new TabControl
        {
            Dock = DockStyle.Fill,
            Appearance = TabAppearance.FlatButtons,
            ItemSize = new Size(0, 1),
            SizeMode = TabSizeMode.Fixed,
            Multiline = true,
            Padding = new Point(0, 0),
        };

        _workspaceTabs.SelectedIndexChanged += (_, _) => SyncSidebarSelection();

        var dashboardTab = new TabPage("Dashboard") { BackColor = Color.Transparent, Padding = new Padding(4, 0, 12, 12) };
        var jobsTab = new TabPage("Jobs") { BackColor = Color.Transparent, Padding = new Padding(4, 0, 12, 12) };
        var settingsTab = new TabPage("Settings") { BackColor = Color.Transparent, Padding = new Padding(4, 0, 12, 12) };

        BuildDashboardTab(dashboardTab);
        BuildJobsTab(jobsTab);
        BuildSettingsTab(settingsTab);

        _workspaceTabs.TabPages.Add(dashboardTab);
        _workspaceTabs.TabPages.Add(jobsTab);
        _workspaceTabs.TabPages.Add(settingsTab);

        container.Controls.Add(_workspaceTabs);
    }

    private void BuildDashboardTab(TabPage tab)
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Color.Transparent,
            Padding = new Padding(0),
        };

        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 126));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        root.Controls.Add(BuildHeroCard(), 0, 0);

        var contentSplit = new SplitContainer
        {
            Dock = DockStyle.Fill,
            IsSplitterFixed = false,
            SplitterDistance = 710,
            Panel1MinSize = 560,
            Panel2MinSize = 340,
            BackColor = Color.Transparent,
            Margin = new Padding(0),
        };

        var leftColumn = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Color.Transparent,
            Padding = new Padding(0, 8, 8, 0),
        };
        leftColumn.RowStyles.Add(new RowStyle(SizeType.Percent, 58));
        leftColumn.RowStyles.Add(new RowStyle(SizeType.Percent, 42));

        leftColumn.Controls.Add(BuildLocalParseCard(), 0, 0);
        leftColumn.Controls.Add(BuildBatchCard(), 0, 1);

        var rightColumn = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Color.Transparent,
            Padding = new Padding(8, 8, 0, 0),
        };
        rightColumn.RowStyles.Add(new RowStyle(SizeType.Percent, 70));
        rightColumn.RowStyles.Add(new RowStyle(SizeType.Percent, 30));

        rightColumn.Controls.Add(BuildStatusCard(), 0, 0);
        rightColumn.Controls.Add(BuildQuickActionsCard(), 0, 1);

        contentSplit.Panel1.Controls.Add(leftColumn);
        contentSplit.Panel2.Controls.Add(rightColumn);

        root.Controls.Add(contentSplit, 0, 1);

        tab.Controls.Add(root);
    }

    private Control BuildHeroCard()
    {
        var hero = new GlassCardPanel
        {
            Dock = DockStyle.Fill,
            Margin = new Padding(0, 0, 0, 10),
            Padding = new Padding(18),
            FillColor = Color.FromArgb(150, 18, 26, 36),
            BorderColor = Color.FromArgb(82, 211, 226, 255),
            CornerRadius = 14,
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            BackColor = Color.Transparent,
        };

        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var title = new Label
        {
            Text = "Drive Folder Processing Workspace",
            ForeColor = Color.WhiteSmoke,
            Font = new Font("Segoe UI Semibold", 18f, FontStyle.Bold),
            Dock = DockStyle.Fill,
        };

        var subtitle = new Label
        {
            Text = "Same workflow as web: choose input, process resumes, export to Sheets. Optimized for desktop operations.",
            ForeColor = Color.FromArgb(216, 227, 242),
            Font = new Font("Segoe UI", 9.5f),
            Dock = DockStyle.Fill,
        };

        var badgeRow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            WrapContents = true,
            FlowDirection = FlowDirection.LeftToRight,
            AutoScroll = false,
            BackColor = Color.Transparent,
            Padding = new Padding(0, 4, 0, 0),
        };

        badgeRow.Controls.Add(CreatePillLabel("Local Resume Parse", Color.FromArgb(64, 103, 194, 140), Color.FromArgb(227, 250, 238)));
        badgeRow.Controls.Add(CreatePillLabel("Google Drive Batch", Color.FromArgb(64, 99, 154, 235), Color.FromArgb(229, 241, 255)));
        badgeRow.Controls.Add(CreatePillLabel("Google Sheets Export", Color.FromArgb(64, 223, 175, 95), Color.FromArgb(255, 243, 225)));

        layout.Controls.Add(title, 0, 0);
        layout.Controls.Add(subtitle, 0, 1);
        layout.Controls.Add(badgeRow, 0, 2);

        hero.Controls.Add(layout);
        return hero;
    }

    private Panel BuildLocalParseCard()
    {
        var card = BuildCard("Local Resume Parse", "Choose one .pdf or .docx and extract candidate fields instantly.");

        var layout = CreateGrid(4, 4);
        layout.RowStyles.Clear();
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 66));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 66));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 66));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 26));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 24));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));

        _filePathInput = new TextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            PlaceholderText = "Select a resume file...",
            BackColor = Color.FromArgb(20, 24, 30),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
        };

        var chooseButton = CreatePrimaryButton("Choose File");
        chooseButton.Click += ChooseFileClicked;

        var parseButton = CreateSecondaryButton("Parse Now");
        parseButton.Click += ParseLocalClicked;

        _nameOutput = CreateReadOnlyOutput();
        _emailOutput = CreateReadOnlyOutput();
        _phoneOutput = CreateReadOnlyOutput();
        _linkedInOutput = CreateReadOnlyOutput();
        _gitHubOutput = CreateReadOnlyOutput();
        _confidenceOutput = CreateReadOnlyOutput();
        _errorsOutput = CreateReadOnlyOutput(multiline: true);

        AddLabeled(layout, "File", _filePathInput, 0, 0, columnSpan: 2);
        layout.Controls.Add(chooseButton, 2, 0);
        layout.Controls.Add(parseButton, 3, 0);

        AddLabeled(layout, "Name", _nameOutput, 0, 1);
        AddLabeled(layout, "Email", _emailOutput, 1, 1);
        AddLabeled(layout, "Phone", _phoneOutput, 2, 1);
        AddLabeled(layout, "Confidence", _confidenceOutput, 3, 1);

        AddLabeled(layout, "LinkedIn", _linkedInOutput, 0, 2, columnSpan: 2);
        AddLabeled(layout, "GitHub", _gitHubOutput, 2, 2, columnSpan: 2);
        AddLabeled(layout, "Errors", _errorsOutput, 0, 3, columnSpan: 4);

        AttachCardContent(card, layout);
        return card;
    }

    private Panel BuildBatchCard()
    {
        var card = BuildCard("Drive Batch Processing", "Queue an async job and export results to Google Sheets as it progresses.");

        var layout = CreateGrid(2, 4);
        layout.RowStyles.Clear();
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 72));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 18));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 18));

        _driveFolderIdInput = new TextBox
        {
            Dock = DockStyle.Fill,
            PlaceholderText = "Google Drive folder ID",
            BackColor = Color.FromArgb(20, 24, 30),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
        };

        _spreadsheetIdInput = new TextBox
        {
            Dock = DockStyle.Fill,
            PlaceholderText = "Spreadsheet ID (optional)",
            BackColor = Color.FromArgb(20, 24, 30),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
        };

        var startJobButton = CreatePrimaryButton("Start Job");
        startJobButton.Click += StartBatchJobClicked;

        var checkJobButton = CreateSecondaryButton("Refresh Status");
        checkJobButton.Click += async (_, _) => await PollJobStatusAsync(force: true);

        AddLabeled(layout, "Google Drive Folder ID", _driveFolderIdInput, 0, 0, columnSpan: 2);
        layout.Controls.Add(startJobButton, 2, 0);
        layout.Controls.Add(checkJobButton, 3, 0);

        AddLabeled(layout, "Spreadsheet ID", _spreadsheetIdInput, 0, 1, columnSpan: 2);

        _jobIdLabel = new Label
        {
            Text = "Job ID: -",
            Dock = DockStyle.Fill,
            ForeColor = Color.Gainsboro,
            Font = new Font("Consolas", 9.5f, FontStyle.Regular),
            TextAlign = ContentAlignment.MiddleLeft,
            AutoEllipsis = true,
            Padding = new Padding(8, 0, 0, 0),
        };

        layout.Controls.Add(_jobIdLabel, 2, 1);
        layout.SetColumnSpan(_jobIdLabel, 2);

        AttachCardContent(card, layout);
        return card;
    }

    private Panel BuildStatusCard()
    {
        var card = BuildCard("Processing Status", "Pipeline timeline and active jobs in this app session.");

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 2,
            BackColor = Color.Transparent,
            Padding = new Padding(6),
        };

        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 62));
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 38));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        _jobProgress = new ProgressBar
        {
            Dock = DockStyle.Fill,
            Style = ProgressBarStyle.Continuous,
            Value = 0,
        };

        _jobMetaLabel = new Label
        {
            Text = "No active job",
            Dock = DockStyle.Fill,
            ForeColor = Color.Gainsboro,
            Font = new Font("Segoe UI", 9f),
            TextAlign = ContentAlignment.MiddleLeft,
            AutoEllipsis = true,
        };

        var progressWrap = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(0, 12, 10, 0),
            BackColor = Color.Transparent,
        };
        progressWrap.Controls.Add(_jobProgress);

        root.Controls.Add(progressWrap, 0, 0);
        root.Controls.Add(_jobMetaLabel, 1, 0);

        _statusSteps = new ListView
        {
            Dock = DockStyle.Fill,
            View = View.Details,
            HeaderStyle = ColumnHeaderStyle.None,
            FullRowSelect = true,
            BackColor = Color.FromArgb(16, 20, 27),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
        };

        _statusSteps.Columns.Add("Step", 400);
        _statusSteps.Resize += (_, _) =>
        {
            if (_statusSteps.Columns.Count > 0)
            {
                _statusSteps.Columns[0].Width = Math.Max(120, _statusSteps.ClientSize.Width - 4);
            }
        };

        foreach (var step in new[]
                 {
                     "Files discovered",
                     "Parsing resumes",
                     "Creating spreadsheet",
                     "Exporting rows",
                     "Completed",
                 })
        {
            _statusSteps.Items.Add(new ListViewItem(step));
        }

        _jobsList = new ListBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(16, 20, 27),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
            IntegralHeight = false,
            Font = new Font("Consolas", 9f),
        };

        root.Controls.Add(_statusSteps, 0, 1);
        root.Controls.Add(_jobsList, 1, 1);

        AttachCardContent(card, root);
        return card;
    }

    private Panel BuildQuickActionsCard()
    {
        var card = BuildCard("Workspace Tools", "Desktop conveniences for local files and diagnostics.");

        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            BackColor = Color.Transparent,
            Padding = new Padding(8),
        };

        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var openJobs = CreateSecondaryButton("Open Jobs Folder");
        openJobs.Click += (_, _) => OpenJobsDirectory();

        var openSettings = CreateSecondaryButton("Open Settings JSON");
        openSettings.Click += (_, _) => OpenSettingsFile();

        var refreshJobs = CreateSecondaryButton("Refresh Job History");
        refreshJobs.Click += async (_, _) => await RefreshJobsAsync();

        var helpText = new Label
        {
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(205, 219, 237),
            Font = new Font("Segoe UI", 8.6f),
            Text = "Tip: use Settings to set Google OAuth client ID/secret before starting Drive jobs.",
            Padding = new Padding(6, 8, 6, 0),
        };

        panel.Controls.Add(openJobs, 0, 0);
        panel.Controls.Add(openSettings, 0, 1);
        panel.Controls.Add(refreshJobs, 0, 2);
        panel.Controls.Add(helpText, 0, 3);

        AttachCardContent(card, panel);
        return card;
    }

    private void BuildJobsTab(TabPage tab)
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Color.Transparent,
            Padding = new Padding(0),
        };

        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 102));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var headerCard = BuildCard("Jobs", "Inspect local job folders, IDs, and session history.");
        var headerContent = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 3,
            RowCount = 1,
            BackColor = Color.Transparent,
            Padding = new Padding(8),
        };

        headerContent.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        headerContent.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));
        headerContent.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));

        var caption = new Label
        {
            Text = "All discovered jobs are persisted under %LOCALAPPDATA%\\SourceStack\\jobs",
            Dock = DockStyle.Fill,
            ForeColor = Color.Gainsboro,
            Font = new Font("Segoe UI", 9f),
            TextAlign = ContentAlignment.MiddleLeft,
        };

        var refreshButton = CreatePrimaryButton("Refresh List");
        refreshButton.Click += async (_, _) => await RefreshJobsAsync();

        var openFolderButton = CreateSecondaryButton("Open Jobs Folder");
        openFolderButton.Click += (_, _) => OpenJobsDirectory();

        headerContent.Controls.Add(caption, 0, 0);
        headerContent.Controls.Add(refreshButton, 1, 0);
        headerContent.Controls.Add(openFolderButton, 2, 0);

        AttachCardContent(headerCard, headerContent);

        var listCard = BuildCard("Job History", "Newest jobs appear first. Use Job ID to inspect specific status.");
        var listPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
            Padding = new Padding(8),
        };

        _jobsHistoryList = new ListBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(16, 20, 27),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Consolas", 10f),
            IntegralHeight = false,
        };

        listPanel.Controls.Add(_jobsHistoryList);
        AttachCardContent(listCard, listPanel);

        root.Controls.Add(headerCard, 0, 0);
        root.Controls.Add(listCard, 0, 1);

        tab.Controls.Add(root);
    }

    private void BuildSettingsTab(TabPage tab)
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            BackColor = Color.Transparent,
        };

        root.RowStyles.Add(new RowStyle(SizeType.Percent, 62));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 38));

        var googleCard = BuildCard("Google Access", "Installed-app OAuth credentials and OCR executable path.");
        var googleLayout = CreateGrid(2, 2);
        googleLayout.RowStyles.Clear();
        googleLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 76));
        googleLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 76));

        googleLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        googleLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));

        _googleClientIdInput = CreateEditableInput();
        _googleClientSecretInput = CreateEditableInput();
        _tesseractPathInput = CreateEditableInput();

        AddLabeled(googleLayout, "Google Client ID", _googleClientIdInput, 0, 0);
        AddLabeled(googleLayout, "Google Client Secret", _googleClientSecretInput, 1, 0);
        AddLabeled(googleLayout, "Tesseract Path", _tesseractPathInput, 0, 1, columnSpan: 2);

        AttachCardContent(googleCard, googleLayout);

        var runtimeCard = BuildCard("Runtime Tuning", "Concurrency, retries, and sheet batching for batch jobs.");
        var runtimeLayout = CreateGrid(3, 3);
        runtimeLayout.RowStyles.Clear();
        runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        runtimeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33));
        runtimeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33));
        runtimeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));

        _maxConcurrencyInput = CreateNumericInput(1, 100, 10);
        _batchSizeInput = CreateNumericInput(1, 5000, 100);
        _maxRetriesInput = CreateNumericInput(1, 10, 3);
        _retryDelayInput = CreateNumericInput(0, 10, 1, decimalPlaces: 1, increment: 0.1m);

        AddLabeled(runtimeLayout, "Max Concurrency", _maxConcurrencyInput, 0, 0);
        AddLabeled(runtimeLayout, "Batch Size", _batchSizeInput, 1, 0);
        AddLabeled(runtimeLayout, "Max Retries", _maxRetriesInput, 2, 0);
        AddLabeled(runtimeLayout, "Retry Delay (sec)", _retryDelayInput, 0, 1);

        var settingsHint = new Label
        {
            Text = "Changes are stored in desktop-settings.json under LocalAppData and applied immediately.",
            ForeColor = Color.FromArgb(205, 219, 237),
            Dock = DockStyle.Fill,
            Font = new Font("Segoe UI", 8.6f),
            Padding = new Padding(8, 10, 8, 0),
        };
        runtimeLayout.Controls.Add(settingsHint, 1, 1);
        runtimeLayout.SetColumnSpan(settingsHint, 2);

        var saveButton = CreatePrimaryButton("Save Settings");
        saveButton.Click += SaveSettingsClicked;
        runtimeLayout.Controls.Add(saveButton, 2, 2);

        AttachCardContent(runtimeCard, runtimeLayout);

        root.Controls.Add(googleCard, 0, 0);
        root.Controls.Add(runtimeCard, 0, 1);

        tab.Controls.Add(root);
    }

    private static TableLayoutPanel CreateGrid(int rows, int columns)
    {
        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = rows,
            ColumnCount = columns,
            BackColor = Color.Transparent,
        };

        for (var row = 0; row < rows; row++)
        {
            panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100f / rows));
        }

        return panel;
    }

    private static Label CreatePillLabel(string text, Color background, Color foreground)
    {
        return new Label
        {
            AutoSize = true,
            Text = text,
            ForeColor = foreground,
            BackColor = background,
            Padding = new Padding(9, 5, 9, 5),
            Margin = new Padding(0, 0, 8, 0),
            Font = new Font("Segoe UI Semibold", 8.3f, FontStyle.Bold),
        };
    }

    private Button CreateSidebarNavButton(string title, string detail, int tabIndex)
    {
        var button = new Button
        {
            Width = 216,
            Height = 62,
            Margin = new Padding(0, 0, 0, 10),
            FlatStyle = FlatStyle.Flat,
            FlatAppearance =
            {
                BorderSize = 1,
                BorderColor = Color.FromArgb(74, 201, 215, 240),
                MouseOverBackColor = Color.FromArgb(88, 43, 59, 83),
                MouseDownBackColor = Color.FromArgb(120, 44, 63, 89),
            },
            BackColor = Color.FromArgb(76, 28, 40, 56),
            ForeColor = Color.WhiteSmoke,
            TextAlign = ContentAlignment.MiddleLeft,
            Font = new Font("Segoe UI Semibold", 9.5f, FontStyle.Bold),
            Text = $"{title}\n{detail}",
            Padding = new Padding(12, 8, 8, 8),
            Tag = tabIndex,
            UseVisualStyleBackColor = false,
        };

        button.Click += (_, _) => SelectWorkspaceTab(tabIndex);
        return button;
    }

    private static Button CreateTopBarButton(string text)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            MinimumSize = new Size(0, 30),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(86, 31, 44, 63),
            ForeColor = Color.WhiteSmoke,
            Font = new Font("Segoe UI", 8.8f),
            Margin = new Padding(0, 0, 8, 0),
            Padding = new Padding(10, 2, 10, 2),
            UseVisualStyleBackColor = false,
        };

        button.FlatAppearance.BorderSize = 1;
        button.FlatAppearance.BorderColor = Color.FromArgb(100, 192, 206, 232);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(105, 45, 62, 89);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(132, 46, 66, 94);

        return button;
    }

    private static GlassCardPanel BuildCard(string titleText, string subtitleText)
    {
        var card = new GlassCardPanel
        {
            Dock = DockStyle.Fill,
            FillColor = Color.FromArgb(145, 16, 23, 32),
            BorderColor = Color.FromArgb(78, 191, 208, 236),
            CornerRadius = 14,
            Padding = new Padding(14),
            Margin = new Padding(0, 0, 0, 12),
        };

        var title = new Label
        {
            Text = titleText,
            ForeColor = Color.WhiteSmoke,
            Font = new Font("Segoe UI Semibold", 12.6f, FontStyle.Bold),
            Dock = DockStyle.Top,
            Height = 30,
            BackColor = Color.Transparent,
        };

        var subtitle = new Label
        {
            Text = subtitleText,
            ForeColor = Color.FromArgb(214, 226, 241),
            Font = new Font("Segoe UI", 8.9f),
            Dock = DockStyle.Top,
            Height = 22,
            BackColor = Color.Transparent,
        };

        var content = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(0, 8, 0, 0),
            BackColor = Color.Transparent,
            Name = "CardContentHost",
        };

        card.Controls.Add(content);
        card.Controls.Add(subtitle);
        card.Controls.Add(title);

        return card;
    }

    private static Button CreatePrimaryButton(string text)
    {
        var button = new Button
        {
            Text = text,
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(230, 237, 248),
            ForeColor = Color.FromArgb(20, 27, 36),
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI Semibold", 9f, FontStyle.Bold),
            Margin = new Padding(6),
            UseVisualStyleBackColor = false,
        };

        button.FlatAppearance.BorderSize = 1;
        button.FlatAppearance.BorderColor = Color.FromArgb(145, 198, 222, 247);
        button.FlatAppearance.MouseOverBackColor = Color.White;
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(216, 226, 244);
        return button;
    }

    private static Button CreateSecondaryButton(string text)
    {
        var button = new Button
        {
            Text = text,
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(90, 28, 41, 58),
            ForeColor = Color.WhiteSmoke,
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 9f, FontStyle.Regular),
            Margin = new Padding(6),
            UseVisualStyleBackColor = false,
        };

        button.FlatAppearance.BorderSize = 1;
        button.FlatAppearance.BorderColor = Color.FromArgb(96, 178, 196, 224);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(120, 40, 55, 78);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(152, 43, 60, 86);
        return button;
    }

    private static TextBox CreateReadOnlyOutput(bool multiline = false)
    {
        return new TextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            Multiline = multiline,
            ScrollBars = multiline ? ScrollBars.Vertical : ScrollBars.None,
            BackColor = Color.FromArgb(20, 24, 30),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
        };
    }

    private static TextBox CreateEditableInput()
    {
        return new TextBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(20, 24, 30),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
        };
    }

    private static NumericUpDown CreateNumericInput(decimal min, decimal max, decimal value, int decimalPlaces = 0, decimal increment = 1)
    {
        return new NumericUpDown
        {
            Dock = DockStyle.Fill,
            Minimum = min,
            Maximum = max,
            Value = value,
            DecimalPlaces = decimalPlaces,
            Increment = increment,
            BackColor = Color.FromArgb(20, 24, 30),
            ForeColor = Color.WhiteSmoke,
            BorderStyle = BorderStyle.FixedSingle,
        };
    }

    private static void AddLabeled(TableLayoutPanel layout, string labelText, Control control, int column, int row, int columnSpan = 1)
    {
        var panel = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(6),
            BackColor = Color.Transparent,
        };

        var label = new Label
        {
            Text = labelText,
            ForeColor = Color.Gainsboro,
            Dock = DockStyle.Top,
            Height = 18,
            Font = new Font("Segoe UI", 8.5f),
            BackColor = Color.Transparent,
        };

        control.Dock = DockStyle.Fill;
        control.Margin = new Padding(0, 4, 0, 0);

        panel.Controls.Add(control);
        panel.Controls.Add(label);

        layout.Controls.Add(panel, column, row);
        if (columnSpan > 1)
        {
            layout.SetColumnSpan(panel, columnSpan);
        }
    }

    private void SelectWorkspaceTab(int index)
    {
        if (index < 0 || index >= _workspaceTabs.TabPages.Count)
        {
            return;
        }

        _workspaceTabs.SelectedIndex = index;
        SyncSidebarSelection();
    }

    private void SyncSidebarSelection()
    {
        ApplySidebarButtonState(_dashboardNavButton, _workspaceTabs.SelectedIndex == 0);
        ApplySidebarButtonState(_jobsNavButton, _workspaceTabs.SelectedIndex == 1);
        ApplySidebarButtonState(_settingsNavButton, _workspaceTabs.SelectedIndex == 2);
    }

    private static void ApplySidebarButtonState(Button button, bool selected)
    {
        if (selected)
        {
            button.BackColor = Color.FromArgb(152, 53, 76, 108);
            button.FlatAppearance.BorderColor = Color.FromArgb(180, 224, 235, 255);
            button.ForeColor = Color.White;
            return;
        }

        button.BackColor = Color.FromArgb(76, 28, 40, 56);
        button.FlatAppearance.BorderColor = Color.FromArgb(74, 201, 215, 240);
        button.ForeColor = Color.WhiteSmoke;
    }

    private static void AttachCardContent(GlassCardPanel card, Control content)
    {
        var host = card.Controls.Find("CardContentHost", searchAllChildren: false).FirstOrDefault() as Panel;
        if (host is null)
        {
            content.Dock = DockStyle.Fill;
            card.Controls.Add(content);
            return;
        }

        content.Dock = DockStyle.Fill;
        host.Controls.Add(content);
    }

    private static decimal Clamp(int value, decimal min, decimal max)
    {
        var dec = (decimal)value;
        if (dec < min)
        {
            return min;
        }

        return dec > max ? max : dec;
    }

    private void ApplySettingsToInputs()
    {
        _googleClientIdInput.Text = _settings.GoogleClientId;
        _googleClientSecretInput.Text = _settings.GoogleClientSecret;
        _tesseractPathInput.Text = _settings.TesseractPath;

        _maxConcurrencyInput.Value = Clamp(_settings.MaxConcurrentRequests, _maxConcurrencyInput.Minimum, _maxConcurrencyInput.Maximum);
        _batchSizeInput.Value = Clamp(_settings.SpreadsheetBatchSize, _batchSizeInput.Minimum, _batchSizeInput.Maximum);
        _maxRetriesInput.Value = Clamp(_settings.MaxRetries, _maxRetriesInput.Minimum, _maxRetriesInput.Maximum);

        var retryDelay = (decimal)_settings.RetryDelaySeconds;
        if (retryDelay < _retryDelayInput.Minimum)
        {
            retryDelay = _retryDelayInput.Minimum;
        }
        else if (retryDelay > _retryDelayInput.Maximum)
        {
            retryDelay = _retryDelayInput.Maximum;
        }

        _retryDelayInput.Value = retryDelay;
    }

    private void RebuildController()
    {
        var options = new SourceStackOptions
        {
            TesseractExecutablePath = string.IsNullOrWhiteSpace(_settings.TesseractPath) ? "tesseract" : _settings.TesseractPath,
            MaxConcurrentRequests = _settings.MaxConcurrentRequests,
            SpreadsheetBatchSize = _settings.SpreadsheetBatchSize,
            MaxRetries = _settings.MaxRetries,
            RetryDelaySeconds = _settings.RetryDelaySeconds,
        };

        var oauthOptions = new GoogleOAuthOptions
        {
            ClientId = _settings.GoogleClientId,
            ClientSecret = _settings.GoogleClientSecret,
        };

        _controller = SourceStackCoreFactory.Create(options, oauthOptions, NullLoggerFactory.Instance);
    }

    private async void ChooseFileClicked(object? sender, EventArgs e)
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "Resume Files|*.pdf;*.docx",
            Title = "Choose Resume",
            Multiselect = false,
        };

        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _filePathInput.Text = dialog.FileName;
            SetStatus($"Selected file: {Path.GetFileName(dialog.FileName)}");

            await Task.CompletedTask;
        }
    }

    private async void ParseLocalClicked(object? sender, EventArgs e)
    {
        var path = _filePathInput.Text.Trim();
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            MessageBox.Show(this, "Select a valid PDF or DOCX file first.", "Missing file", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try
        {
            SetStatus("Parsing local file...");

            var options = new SourceStackOptions
            {
                TesseractExecutablePath = string.IsNullOrWhiteSpace(_settings.TesseractPath) ? "tesseract" : _settings.TesseractPath,
            };

            var ocr = new TesseractCliOcrService(options, NullLogger<TesseractCliOcrService>.Instance);
            var pdf = new PdfTextExtractor(ocr, NullLogger<PdfTextExtractor>.Instance);
            var parser = new ResumeDocumentParser(pdf, NullLogger<ResumeDocumentParser>.Instance);

            var fileName = Path.GetFileName(path);
            var bytes = await File.ReadAllBytesAsync(path);
            var parsed = await parser.ParseResumeBytesAsync(fileName, bytes);

            _nameOutput.Text = parsed.Name ?? string.Empty;
            _emailOutput.Text = parsed.Email ?? string.Empty;
            _phoneOutput.Text = parsed.Phone ?? string.Empty;
            _linkedInOutput.Text = parsed.LinkedIn ?? string.Empty;
            _gitHubOutput.Text = parsed.GitHub ?? string.Empty;
            _confidenceOutput.Text = parsed.Confidence.ToString("0.00");
            _errorsOutput.Text = parsed.Errors.Count == 0 ? string.Empty : string.Join(Environment.NewLine, parsed.Errors);

            SetStatus("Local parse completed");
        }
        catch (Exception ex)
        {
            SetStatus("Local parse failed");
            MessageBox.Show(this, ex.Message, "Parse failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async void StartBatchJobClicked(object? sender, EventArgs e)
    {
        if (_controller is null)
        {
            MessageBox.Show(this, "Controller is not initialized.", "Internal error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var folderId = _driveFolderIdInput.Text.Trim();
        if (string.IsNullOrWhiteSpace(folderId))
        {
            MessageBox.Show(this, "Provide Google Drive Folder ID.", "Missing folder ID", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        if (string.IsNullOrWhiteSpace(_settings.GoogleClientId))
        {
            MessageBox.Show(this, "Set Google Client ID in Settings first.", "Missing Google settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            SelectWorkspaceTab(2);
            return;
        }

        try
        {
            SetStatus("Starting batch job...");

            var spreadsheetId = _spreadsheetIdInput.Text.Trim();
            _activeJobId = await _controller.StartFolderProcessingAsync(
                folderId,
                string.IsNullOrWhiteSpace(spreadsheetId) ? null : spreadsheetId);

            _jobIdLabel.Text = $"Job ID: {_activeJobId}";
            _jobsList.Items.Insert(0, _activeJobId);
            if (!_jobsHistoryList.Items.Contains(_activeJobId))
            {
                _jobsHistoryList.Items.Insert(0, _activeJobId);
            }

            ResetStepHighlights();
            HighlightStep(0, Color.DeepSkyBlue);

            _jobPollTimer.Start();
            SetStatus("Batch job started");

            await RefreshJobsAsync();
        }
        catch (Exception ex)
        {
            SetStatus("Failed to start batch job");
            MessageBox.Show(this, ex.Message, "Start job failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task PollJobStatusAsync(bool force = false)
    {
        if (_controller is null || string.IsNullOrWhiteSpace(_activeJobId))
        {
            return;
        }

        try
        {
            var status = await _controller.GetJobStatusAsync(_activeJobId);

            _jobProgress.Value = Math.Max(0, Math.Min(100, status.Progress));
            _jobMetaLabel.Text = $"{status.Status} | {status.ProcessedFiles}/{status.TotalFiles} files | {status.Progress}%";

            UpdateStepsFromStatus(status);

            if (status.Status == JobProcessingState.Completed || status.Status == JobProcessingState.Failed || status.Status == JobProcessingState.Revoked)
            {
                _jobPollTimer.Stop();

                if (status.Status == JobProcessingState.Completed)
                {
                    HighlightStep(4, Color.LimeGreen);
                    SetStatus("Batch job completed");
                }
                else
                {
                    SetStatus($"Batch job ended: {status.Status}");
                }

                await RefreshJobsAsync();
            }
            else if (force)
            {
                SetStatus("Job status refreshed");
            }
        }
        catch (Exception ex)
        {
            _jobPollTimer.Stop();
            SetStatus("Job polling failed");
            MessageBox.Show(this, ex.Message, "Job status failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void UpdateStepsFromStatus(JobStatus status)
    {
        ResetStepHighlights();

        if (status.Status == JobProcessingState.Pending)
        {
            HighlightStep(0, Color.DeepSkyBlue);
            return;
        }

        if (status.Status == JobProcessingState.Processing)
        {
            var progress = status.Progress;
            if (progress < 30)
            {
                HighlightStep(0, Color.LimeGreen);
                HighlightStep(1, Color.DeepSkyBlue);
            }
            else if (progress < 80)
            {
                HighlightStep(0, Color.LimeGreen);
                HighlightStep(1, Color.LimeGreen);
                HighlightStep(2, Color.DeepSkyBlue);
            }
            else
            {
                HighlightStep(0, Color.LimeGreen);
                HighlightStep(1, Color.LimeGreen);
                HighlightStep(2, Color.LimeGreen);
                HighlightStep(3, Color.DeepSkyBlue);
            }

            return;
        }

        if (status.Status == JobProcessingState.Completed)
        {
            for (var i = 0; i < _statusSteps.Items.Count; i++)
            {
                HighlightStep(i, Color.LimeGreen);
            }

            return;
        }

        for (var i = 0; i < _statusSteps.Items.Count; i++)
        {
            HighlightStep(i, Color.OrangeRed);
        }
    }

    private void ResetStepHighlights()
    {
        foreach (ListViewItem item in _statusSteps.Items)
        {
            item.ForeColor = Color.Gainsboro;
        }
    }

    private void HighlightStep(int index, Color color)
    {
        if (index < 0 || index >= _statusSteps.Items.Count)
        {
            return;
        }

        _statusSteps.Items[index].ForeColor = color;
    }

    private Task RefreshJobsAsync()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var ordered = new List<string>();

        foreach (var item in _jobsList.Items)
        {
            if (item is not string id || string.IsNullOrWhiteSpace(id) || !seen.Add(id))
            {
                continue;
            }

            ordered.Add(id);
        }

        var root = GetJobsRootPath();
        if (Directory.Exists(root))
        {
            var persisted = Directory
                .EnumerateDirectories(root)
                .Select(path => new { JobId = Path.GetFileName(path), Created = Directory.GetCreationTimeUtc(path) })
                .Where(item => !string.IsNullOrWhiteSpace(item.JobId))
                .OrderByDescending(item => item.Created)
                .Select(item => item.JobId!);

            foreach (var id in persisted)
            {
                if (seen.Add(id))
                {
                    ordered.Add(id);
                }
            }
        }

        _jobsHistoryList.BeginUpdate();
        _jobsHistoryList.Items.Clear();
        foreach (var id in ordered)
        {
            _jobsHistoryList.Items.Add(id);
        }

        _jobsHistoryList.EndUpdate();

        SetStatus($"Job history refreshed ({ordered.Count} jobs)");
        return Task.CompletedTask;
    }

    private void SaveSettingsClicked(object? sender, EventArgs e)
    {
        _settings.GoogleClientId = _googleClientIdInput.Text.Trim();
        _settings.GoogleClientSecret = _googleClientSecretInput.Text.Trim();
        _settings.TesseractPath = _tesseractPathInput.Text.Trim();
        _settings.MaxConcurrentRequests = (int)_maxConcurrencyInput.Value;
        _settings.SpreadsheetBatchSize = (int)_batchSizeInput.Value;
        _settings.MaxRetries = (int)_maxRetriesInput.Value;
        _settings.RetryDelaySeconds = (double)_retryDelayInput.Value;

        SettingsStore.Save(_settings);
        RebuildController();

        SetStatus("Settings saved");
        MessageBox.Show(this, "Settings saved successfully.", "Saved", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private static string GetJobsRootPath()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SourceStack",
            "jobs");
    }

    private void OpenJobsDirectory()
    {
        try
        {
            var path = GetJobsRootPath();
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Cannot open jobs folder", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void OpenSettingsFile()
    {
        try
        {
            var path = DesktopSettings.GetSettingsPath();
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            if (!File.Exists(path))
            {
                SettingsStore.Save(_settings);
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Cannot open settings file", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void SetStatus(string message)
    {
        _statusLabel.Text = message;
    }
}
