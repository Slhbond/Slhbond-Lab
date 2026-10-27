当前版本：**v2.0.0**

博客是“文件即内容”，不使用数据库。文章、图片、站点配置都在文件里，所以迁移只需要复制文件。

## 一、旧版本升级到 v2.0.0

### 1. 先备份

在旧服务器执行：

~~~bash
cd /root/blog
bash deploy/backup.sh /root/slhbond-backup.tar.gz
~~~

备份包含：

~~~text
posts/          文章和 posts/assets 图片
config.js       站点标题、作者、密码、导航
data/           标签、排序、登录会话
public/images/  站点图片
~~~

### 2. 更新代码

把新版本的代码包解压到项目目录，保留原来的 posts、config.js、data、public/images。

如果使用一键脚本：

~~~bash
cd /root/blog
bash deploy/install.sh
~~~

脚本会保留文章、配置、数据和图片，只更新程序代码。

### 3. 启动并检查

~~~bash
cd /root/blog
docker compose up -d --build
systemctl status slhbond-blog --no-pager
~~~

打开首页，检查：

- 文章数量是否正确
- 图片是否显示
- 首页标题、副标题、公告是否正常
- 文章右侧目录是否出现
- 后台是否能登录

## 二、迁移到新设备

### 方式 A：备份和恢复脚本

老设备：

~~~bash
cd /root/blog
bash deploy/backup.sh /root/slhbond-backup.tar.gz
~~~

传到新设备：

~~~bash
scp /root/slhbond-backup.tar.gz root@新服务器IP:/root/
~~~

新设备准备代码后：

~~~bash
cd /root/blog
bash deploy/restore.sh /root/slhbond-backup.tar.gz
systemctl enable --now slhbond-blog
~~~

### 方式 B：手动复制

把这些文件/目录复制到新设备的相同位置：

~~~text
posts/
posts/assets/
config.js
data/
public/images/
~~~

然后：

~~~bash
cd /root/blog
docker compose up -d --build
~~~

## 三、只迁移一篇文章

1. 把 .md 文件放到 posts/
2. 文章里的图片放到 posts/assets/
3. 图片地址保持 /images/xxx.png
4. 刷新页面即可

不需要数据库，也不需要重新发布。

## 四、注意事项

- 不要用仓库里的 config.js 覆盖线上已经改过密码的 config.js
- 迁移前先备份 posts/ 和 config.js
- 文章图片一定要连同 posts/assets/ 一起复制
- 换域名时修改 Cloudflare Tunnel 或反向代理的 hostname
- 卸载脚本默认保留数据，彻底删除请使用 --purge

## 五、安装和卸载

安装：

~~~bash
sudo bash deploy/install.sh
~~~

卸载容器和开机服务，但保留文章和配置：

~~~bash
sudo bash deploy/uninstall.sh
~~~

彻底删除整个项目目录（不可恢复）：

~~~bash
sudo bash deploy/uninstall.sh --purge
~~~
