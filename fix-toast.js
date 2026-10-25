const fs = require('fs');
const p = 'D:/illusion-C#/illusionLauncher/IllusionLauncherWPF/IllusionLauncherWPF/wwwroot/index.html';
let h = fs.readFileSync(p, 'utf8');

const re = /window\.onSkinUploadResult = function \(data\) \{[\s\S]*?\r?\n\s*\}\s*;/;
if (!re.test(h)) { console.log('onSkinUploadResult not found'); process.exit(1); }

const newFn = `window.onSkinUploadResult = function (data) {
				var okToast = data && data.ok;
				showSideToast(
					okToast ? '皮肤已同步到正版' : '皮肤同步失败',
					okToast ? '重新进入游戏即可看到新皮肤' : ((data && data.error) ? data.error : '未知错误'),
					100
				);
				// 统一 5 秒后自动收起（showSideToast 本身不会自动隐藏）
				if (window._toastHideTimer) clearTimeout(window._toastHideTimer);
				window._toastHideTimer = setTimeout(hideSideToast, 5000);
			};`;

h = h.replace(re, newFn);
fs.writeFileSync(p, h, 'utf8');
console.log('toast duration -> 5s');
