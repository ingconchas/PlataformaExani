/* Cargador compartido de componentes del design system para las pantallas.
   Uso, dentro de un <script type="text/babel"> con React/ReactDOM/Babel ya cargados:
     const { SidebarNav, DataTable } = await UNXScreen.load(['SidebarNav', 'DataTable']);
   Carga los .jsx locales (no el bundle) para reflejar siempre la última versión de cada componente. */
(function () {
  const PATHS = {
    // forms
    Button: 'forms/Button.jsx', Input: 'forms/Input.jsx', PasswordInput: 'forms/PasswordInput.jsx',
    Select: 'forms/Select.jsx', MultiSelect: 'forms/MultiSelect.jsx', Checkbox: 'forms/Checkbox.jsx',
    Radio: 'forms/Radio.jsx', Textarea: 'forms/Textarea.jsx', SearchInput: 'forms/SearchInput.jsx', FileDrop: 'forms/FileDrop.jsx',
    // display
    Card: 'display/Card.jsx', Badge: 'display/Badge.jsx', Alert: 'display/Alert.jsx', Tabs: 'display/Tabs.jsx',
    DataTable: 'display/DataTable.jsx', MetricCard: 'display/MetricCard.jsx', ShortcutCard: 'display/ShortcutCard.jsx',
    ExamCard: 'display/ExamCard.jsx', ProgressBar: 'display/ProgressBar.jsx', Modal: 'display/Modal.jsx',
    Toast: 'display/Toast.jsx', Breadcrumb: 'display/Breadcrumb.jsx', Avatar: 'display/Avatar.jsx', Stepper: 'display/Stepper.jsx',
    // charts
    LineChart: 'charts/LineChart.jsx', HBarChart: 'charts/HBarChart.jsx',
    // exam
    ExamTimer: 'exam/ExamTimer.jsx', AnswerOption: 'exam/AnswerOption.jsx',
    // gamification
    StreakChip: 'gamification/StreakChip.jsx', AchievementBadge: 'gamification/AchievementBadge.jsx',
    DifficultyMeter: 'gamification/DifficultyMeter.jsx', CelebrationToast: 'gamification/CelebrationToast.jsx',
    // layouts
    SidebarNav: 'layouts/SidebarNav.jsx', PageHeader: 'layouts/PageHeader.jsx', BottomNav: 'layouts/BottomNav.jsx',
    StudentHeader: 'layouts/StudentHeader.jsx', ExamHeader: 'layouts/ExamHeader.jsx',
  };
  const cache = {};
  window.UNXScreen = {
    async load(names) {
      const ex = {};
      for (const n of names) {
        if (cache[n]) { ex[n] = cache[n]; continue; }
        const p = PATHS[n];
        if (!p) throw new Error('Componente desconocido: ' + n);
        let src = await (await fetch('../components/' + p)).text();
        src = src.replace(/^import .*$/gm, '').replace(/export function (\w+)/g, 'ex.$1 = function $1');
        eval(Babel.transform(src, { presets: [['react', { runtime: 'classic' }]] }).code);
        cache[n] = ex[n];
      }
      return ex;
    },
  };
})();
