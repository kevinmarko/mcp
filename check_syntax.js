const fs = require('fs');
const babel = require('@babel/core');
const html = fs.readFileSync('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'utf8');
const match = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (match) {
    try {
        babel.transformSync(match[1], { presets: ['@babel/preset-react'] });
        console.log("Syntax OK");
    } catch (e) {
        console.error("Syntax Error:", e);
        process.exit(1);
    }
} else {
    console.log("No babel script found");
}
