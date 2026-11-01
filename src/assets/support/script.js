/* Technamooz Panel — support center */
(function () {
    'use strict';

    const year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
}());
