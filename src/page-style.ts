/**
 * The stylesheet of every HTML page, inlined into a `<style>` element. Colors, sizes, and the
 * Markdown and diff styles follow GitHub's light theme and the gate 2 mockups in
 * documents/design/mock-2026-10-05/.
 */
export const pageStyle = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#ffffff;color:#1f2328;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5}
a{color:#0969da;text-decoration:none}
a:hover{text-decoration:underline}
code,pre,.diff-table{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;font-size:12px}
.page{max-width:1280px;margin:0 auto}
.app-header{display:flex;align-items:center;gap:8px 16px;padding:12px 32px;background:#f6f8fa;border-bottom:1px solid #d0d7de;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;color:#1f2328}
.separator{color:#59636e}
.repo-nav{display:flex;gap:4px;margin-left:16px}
.repo-nav a{padding:6px 10px;border-radius:6px;color:#1f2328}
.repo-nav a[aria-current="page"]{background:#ffffff;border-bottom:2px solid #fd8c73}
.preview-note{margin-left:auto;display:flex;align-items:center;gap:8px;color:#59636e}
.preview-note::before{content:"";width:8px;height:8px;border-radius:50%;background:#1a7f37}
main{padding:24px 32px;display:flex;flex-direction:column;gap:16px}
.title-row{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.title-row h1{margin:0;flex:1 1 500px;min-width:0;font-size:32px;font-weight:400;line-height:1.25;overflow-wrap:anywhere}
.number{color:#59636e;font-weight:300}
.button{display:inline-block;padding:5px 16px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;color:#1f2328;font:inherit;font-weight:500;cursor:pointer}
.button-danger{color:#cf222e}
.button-danger-solid{background:#cf222e;border-color:#cf222e;color:#ffffff}
.button-primary{padding:8px 16px;background:#1f883d;border-color:#1f883d;color:#ffffff}
.delete-preview{position:relative}
.delete-preview summary{list-style:none}
.delete-preview summary::-webkit-details-marker{display:none}
.delete-confirm{position:absolute;right:0;top:calc(100% + 8px);z-index:1;width:300px;max-width:calc(100vw - 32px);padding:16px;background:#ffffff;border:1px solid #d0d7de;border-radius:6px;box-shadow:0 8px 24px rgba(140,149,159,0.2);display:flex;flex-direction:column;gap:12px}
.delete-confirm p,.delete-confirm form{margin:0}
.meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:#59636e}
.state-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:6px;color:#ffffff;font-weight:500}
.state-badge.state-issue-open,.state-badge.state-pull-open{background:#1f883d}
.state-badge.state-issue-closed{background:#8250df}
.state-badge.state-pull-closed{background:#cf222e}
.state-mark{display:inline-flex;padding-top:2px}
.state-mark.state-issue-open,.state-mark.state-pull-open{color:#1a7f37}
.state-mark.state-issue-closed{color:#8250df}
.state-mark.state-pull-closed{color:#cf222e}
.branch{padding:2px 6px;border-radius:6px;background:#ddf4ff;color:#0969da}
.tabs{display:flex;gap:4px;margin-top:8px;border-bottom:1px solid #d0d7de}
.tabs a{padding:8px 16px;color:#1f2328}
.counter{margin-left:4px;padding:1px 8px;border-radius:10px;background:#eff1f3;font-size:12px}
.timeline{display:flex;flex-direction:column;gap:16px}
.timeline-item{min-width:0;border:1px solid #d0d7de;border-radius:6px}
.timeline-item-header{padding:8px 16px;background:#f6f8fa;border-bottom:1px solid #d0d7de;border-radius:6px 6px 0 0;color:#59636e}
.markdown-body{padding:16px;overflow-wrap:break-word}
.markdown-body>*:first-child{margin-top:0}
.markdown-body>*:last-child{margin-bottom:0}
.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body table,.markdown-body pre,.markdown-body blockquote{margin:0 0 16px}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6{margin:24px 0 16px;font-weight:600;line-height:1.25}
.markdown-body h1{padding-bottom:0.3em;border-bottom:1px solid #d1d9e0;font-size:2em}
.markdown-body h2{padding-bottom:0.3em;border-bottom:1px solid #d1d9e0;font-size:1.5em}
.markdown-body h3{font-size:1.25em}
.markdown-body h4{font-size:1em}
.markdown-body h5{font-size:0.875em}
.markdown-body h6{font-size:0.85em;color:#59636e}
.markdown-body ul,.markdown-body ol{padding-left:2em}
.markdown-body li+li{margin-top:0.25em}
.markdown-body .contains-task-list{padding-left:0;list-style:none}
.markdown-body .task-list-item-checkbox{margin:0 0.5em 0.25em 0;vertical-align:middle}
.markdown-body code{padding:0.2em 0.4em;border-radius:6px;background:rgba(129,139,152,0.12);font-size:85%}
.markdown-body pre{padding:16px;overflow:auto;border-radius:6px;background:#f6f8fa;font-size:85%;line-height:1.45}
.markdown-body pre code{padding:0;background:transparent;font-size:100%}
.markdown-body table{display:block;width:max-content;max-width:100%;overflow:auto;border-collapse:collapse}
.markdown-body th,.markdown-body td{padding:6px 13px;border:1px solid #d1d9e0}
.markdown-body th{font-weight:600}
.markdown-body tr:nth-child(2n){background:#f6f8fa}
.markdown-body blockquote{padding:0 1em;border-left:0.25em solid #d1d9e0;color:#59636e}
.markdown-body img{max-width:100%}
.markdown-body hr{height:0.25em;margin:24px 0;padding:0;border:0;background:#d1d9e0}
.empty-body{color:#59636e}
.files{display:flex;flex-direction:column;gap:16px}
.files-summary{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;color:#59636e}
.files-summary strong{color:#1f2328}
.additions{color:#1a7f37}
.deletions{color:#cf222e}
.file-list{margin:0;padding:0;list-style:none;border:1px solid #d0d7de;border-radius:6px}
.file-list li{display:flex;align-items:center;gap:12px;padding:8px 16px;flex-wrap:wrap}
.file-list li+li{border-top:1px solid #d0d7de}
.file{overflow:hidden;border:1px solid #d0d7de;border-radius:6px}
.file-header{display:flex;align-items:center;gap:12px;padding:8px 16px;background:#f6f8fa;border-bottom:1px solid #d0d7de;flex-wrap:wrap}
.file-note{margin:0;padding:8px 16px;border-bottom:1px solid #d0d7de;color:#59636e}
.diff-scroll{overflow-x:auto}
.diff-table{width:100%;border-collapse:collapse;line-height:20px}
.line-number{width:1%;min-width:48px;padding:0 8px;color:#59636e;text-align:right;white-space:nowrap;user-select:none}
.line-code{padding:0 16px;white-space:pre}
.diff-hunk{background:#ddf4ff;color:#59636e}
.diff-line-addition{background:#dafbe1}
.diff-line-deletion{background:#ffebe9}
.diff-line-note{color:#59636e}
.list{border:1px solid #d0d7de;border-radius:6px}
.list-header{display:flex;gap:16px;padding:16px;background:#f6f8fa;border-bottom:1px solid #d0d7de;border-radius:6px 6px 0 0}
.list-header a{color:#59636e}
.list-header a[aria-current="page"]{color:#1f2328;font-weight:600}
.list-row{display:flex;align-items:flex-start;gap:8px;padding:8px 16px}
.list-row+.list-row{border-top:1px solid #d0d7de}
.list-title{color:#1f2328;font-size:16px;font-weight:600;overflow-wrap:anywhere}
.list-meta{color:#59636e;font-size:12px}
.blankslate{margin:0;padding:32px 16px;color:#59636e;text-align:center}
.blankslate h1{margin:0 0 8px;color:#1f2328;font-size:20px;font-weight:600}
.blankslate p{margin:0 0 8px}
.send-hint{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding-top:16px;border-top:1px solid #d0d7de;color:#59636e}
.send-hint code{padding:4px 8px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa}
.login{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:48px 16px;background:#f6f8fa}
.login-brand{display:flex;align-items:center;gap:10px;font-size:24px;font-weight:600}
.login form{width:100%;max-width:360px;padding:24px;background:#ffffff;border:1px solid #d0d7de;border-radius:6px;display:flex;flex-direction:column;gap:16px}
.login h1{margin:0;font-size:20px;font-weight:500}
.login p{margin:0;color:#59636e}
.login .field{display:flex;flex-direction:column;gap:6px}
.login label{font-weight:500}
.login input{width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font:inherit}
.login .note{font-size:12px}
.login .error{padding:8px 12px;border:1px solid #ff8182;border-radius:6px;background:#ffebe9;color:#d1242f}
@media (max-width:640px){.app-header,main{padding-left:16px;padding-right:16px}.repo-nav,.preview-note{margin-left:0}.title-row h1{font-size:24px}.delete-confirm{left:0;right:auto}}
`;
