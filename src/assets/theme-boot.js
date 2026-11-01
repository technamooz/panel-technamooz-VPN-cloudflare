(function () {
    try {
        var theme = localStorage.getItem('technamooz-theme');
        if (theme !== 'light' && theme !== 'dark') {
            theme = localStorage.getItem('darkMode') === 'disabled' ? 'light' : 'dark';
        }
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
    } catch (error) {
        document.documentElement.dataset.theme = 'dark';
    }
}());
