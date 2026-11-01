# Technamooz Panel v1.0.0

اولین نسخهٔ رسمی Technamooz Panel.

## تغییرات اصلی

- تغییر کامل هویت محصول به **Technamooz Panel**.
- تنظیم version سراسری پروژه روی `1.0.0`.
- بازطراحی رابط کاربری پنل با زبان بصری Ember Glass.
- تم Dark با مشکی، خاکستری عمیق و قرمز کنترل‌شده.
- تم Light مستقل با سفید، خاکستری گرم و قرمز.
- بازطراحی صفحات Login، Secret Generator، Proxy IP و Error.
- حفظ کامل endpointها، فرم‌ها، validation، authentication و منطق تولید کانفیگ.
- حذف dependency آسیب‌پذیر `html-minifier` از build pipeline.
- اصلاح build pipeline برای منتظرماندن واقعی تا تولید `dist/worker.zip` کامل شود.
- حفظ خروجی‌های استاندارد Deploy:
  - `dist/worker.js` برای Cloudflare Workers
  - `dist/worker.zip` برای Cloudflare Pages Direct Upload

## اعتبارسنجی

- TypeScript check موفق.
- Build موفق.
- ZIP خروجی سالم و قابل استخراج.
- Audit dependencyها بدون آسیب‌پذیری high یا critical.
- هیچ ارجاع متنی به هویت قدیمی در سورس پروژه باقی نمانده است.
