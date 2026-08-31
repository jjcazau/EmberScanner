# FAQ

**Q: How do I update from version 5 to version 6**

A: First, don't use the update.js script, it won't work since the server portion of version 6 as been completely rewritten in GO. Simply unzip the archive that contains the Ember Scanner executable and its PDF document to a new folder, then copy the database.sqlite from version 5 to the new folder that contains version 6 and make sure to rename it to _ember-scanner.db_.

**Q: I tried the autocert function but I get strange error messages**

A: Due to the ACME protocol used by Let's Encrypt, ports 80 and 443 must be open to the world for the autocert to work. The domain specified via the `-ssl_auto_cert` argument must also match the IP address of your Ember Scanner instance.

**Q: How do I install FFMPEG on Windows**

A: Please follow instructions at this address: [https://www.wikihow.com/Install-FFmpeg-on-Windows](https://www.wikihow.com/Install-FFmpeg-on-Windows)

**Q: How do I configure a reverse-proxy in front of Ember Scanner**

A: There are so many reverse proxy technologies out there that it's hard the cover them all. One thing to keep in mind is that Ember Scanner works with websockets, so the reverse proxy must also supports websockets to work properly with Ember Scanner. For some examples, take a look at the [https://github.com/jjcazau/EmberScanner/tree/master/docs/examples/apache](https://github.com/jjcazau/EmberScanner/tree/master/docs/examples/apache) for `Apache HTTP` or [https://github.com/jjcazau/EmberScanner/tree/master/docs/examples/nginx](https://github.com/jjcazau/EmberScanner/tree/master/docs/examples/nginx) for `nginx`.

**Q: How do I get notified when a new release is available**

A: Use the GitHub `watch` feature. This requires you to have a GitHub account, which you can create for free. Go to the Ember Scanner repository at [https://github.com/jjcazau/EmberScanner](https://github.com/jjcazau/EmberScanner) and select the `watch` button. You can be notified of every change made to the repository, or simply be notified when a new release is available.

**Q: How can I listen to multiple instances from the same server**

A: Simply open a new browser tab to the same URL with a special `id` parameter that will distinguish each instance from the other. This allows you to remember the selection of talkgroups for each of the instances. Without the `id` parameter, only the last talkgroups selection is remembered across all instances. For example: `http://localhost:3000/?id=instance2`.

**Q: How can I reset/change the previously entered access code**

A: Ember Scanner stores this information in the local storage section of the browser where you can manually delete the passcode. As a handy url, you can append the path "/reset" to the url so that Ember Scanner clears the contents of local storage and reloads the page to the main url. Example: http://localhost:3000/reset.

**Q: I did not find an answer to my question in this FAQ**

A: Open a topic in [Ember Scanner Discussions](https://github.com/jjcazau/EmberScanner/discussions) and include the recorder name and relevant integration details.

\pagebreak{}
