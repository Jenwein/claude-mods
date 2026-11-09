# claude-mods

自己写的 Claude Code Mod（函数钩子插件），整个仓库是一个插件市场。终端和桌面 App 的 Code 标签页都能用。

| Mod | 作用 |
| --- | --- |
| [git-band](git-band) | 在输入框上方显示当前 git 分支、未提交文件数和 ↑↓ 提交数，每 3 秒刷新 |
| [wt-panel](wt-panel) | `/wt` 打开当前仓库的 worktree 总览面板：状态、改动、复制路径、VS Code 打开、带风险提醒的删除 |

## 安装

在 Claude Code 的终端会话里，每个 Mod 一行（`<mod>` 换成上表里的名字），第一次会问是否添加这个插件市场，回答 `y`，再选安装范围：

```
/plugin install <mod> --marketplace Jenwein/claude-mods
```

或者在命令行里：

```bash
claude plugin install <mod> --marketplace Jenwein/claude-mods
```

按用户范围安装后，之后的每个会话都会自动加载。

## 修改

想边改边用，就把本地克隆加成插件市场再安装，插件会直接从这个文件夹读取：

```bash
claude plugin marketplace add <克隆所在的路径>
claude plugin install <mod>@claude-mods
```

改完文件后，在会话里运行 `/reload-plugins` 就会生效，不用重装。

检查和测试：

```bash
claude plugin validate <mod>
claude plugin test <mod>
```
