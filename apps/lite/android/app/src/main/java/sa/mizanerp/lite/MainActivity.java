package sa.mizanerp.lite;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * ميزان لايت — غلاف أندرويد.
 * يعرض التطبيق (ملف واحد داخل assets) من عنوان افتراضي آمن https://lite.mizan.local
 * ليعمل التخزين المحلي (IndexedDB) بثبات، بلا خادم وبلا إنترنت.
 */
public class MainActivity extends Activity {
    private static final String HOST = "lite.mizan.local";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 11;
    private static final int REQ_SAVE = 12;
    private static final int REQ_CAM = 13;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;
    private PermissionRequest pendingCam;
    private long lastBack;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false); // معاينة الكاميرا لقارئ الباركود
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "MizanNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.length() <= 1) path = "/index.html";
                try {
                    InputStream in = getAssets().open(path.substring(1));
                    return new WebResourceResponse(mimeOf(path), "UTF-8", in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openExternal(u.toString());
                return true; // لا يُفتح أي موقع خارجي داخل التطبيق
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            /** الكاميرا لقارئ الباركود فقط، ولصفحة التطبيق نفسها فقط */
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        boolean cam = false;
                        for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) cam = true;
                        Uri o = request.getOrigin();
                        if (!cam || o == null || !HOST.equals(o.getHost())) {
                            request.deny();
                            return;
                        }
                        if (Build.VERSION.SDK_INT < 23) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                            return;
                        }
                        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                            return;
                        }
                        if (pendingCam != null) pendingCam.deny();
                        pendingCam = request;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM);
                    }
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingCam == request) pendingCam = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    toast("لا يوجد تطبيق لاختيار الملفات");
                }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(START);
    }

    private static String mimeOf(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void openExternal(String url) {
        if (url == null || !url.startsWith("https://")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            toast("تعذر فتح الرابط");
        }
    }

    /** الدوال التي تستدعيها الواجهة عبر window.MizanNative */
    private class Bridge {
        @JavascriptInterface
        public void print(final String title) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String job = (title == null || title.isEmpty()) ? "Mizan Lite" : title;
                        PrintManager pm = (PrintManager) MainActivity.this.getSystemService(Context.PRINT_SERVICE);
                        pm.print(job, web.createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
                    } catch (Exception e) {
                        toast("الطباعة غير متاحة على هذا الجهاز");
                    }
                }
            });
        }

        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        pendingSave = Base64.decode(base64, Base64.DEFAULT);
                        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        i.addCategory(Intent.CATEGORY_OPENABLE);
                        i.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                        i.putExtra(Intent.EXTRA_TITLE, name);
                        startActivityForResult(i, REQ_SAVE);
                    } catch (Exception e) {
                        pendingSave = null;
                        toast("تعذر حفظ الملف على هذا الجهاز");
                    }
                }
            });
        }

        @JavascriptInterface
        public void shareText(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("text/plain");
                        i.putExtra(Intent.EXTRA_TEXT, text);
                        startActivity(Intent.createChooser(i, "مشاركة"));
                    } catch (Exception e) {
                        toast("المشاركة غير متاحة");
                    }
                }
            });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openExternal(url);
                }
            });
        }

        /** جلب ملف نصي صغير (ملف الإصدارات) عبر HTTPS ثم استدعاء window[callback](body) — أو null عند الفشل */
        @JavascriptInterface
        public void httpGet(final String url, final String callback) {
            if (callback == null || !callback.matches("[A-Za-z_][A-Za-z0-9_]*")) return;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String body = null;
                    HttpURLConnection c = null;
                    try {
                        if (url != null && url.startsWith("https://")) {
                            c = (HttpURLConnection) new URL(url).openConnection();
                            c.setConnectTimeout(8000);
                            c.setReadTimeout(8000);
                            c.setInstanceFollowRedirects(true);
                            if (c.getResponseCode() == 200) {
                                InputStream in = c.getInputStream();
                                ByteArrayOutputStream out = new ByteArrayOutputStream();
                                byte[] buf = new byte[4096];
                                int n;
                                while ((n = in.read(buf)) > 0 && out.size() < 65536) out.write(buf, 0, n);
                                in.close();
                                body = out.toString("UTF-8");
                            }
                        }
                    } catch (Exception e) {
                        body = null;
                    } finally {
                        if (c != null) c.disconnect();
                    }
                    final String js = "window." + callback + "&&window." + callback + "(" + (body == null ? "null" : JSONObject.quote(body)) + ")";
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            web.evaluateJavascript(js, null);
                        }
                    });
                }
            }).start();
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
        } else if (requestCode == REQ_SAVE) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
            try {
                OutputStream os = getContentResolver().openOutputStream(data.getData());
                if (os == null) throw new IllegalStateException();
                os.write(bytes);
                os.close();
                toast("تم حفظ الملف");
            } catch (Exception e) {
                toast("تعذر حفظ الملف");
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_CAM || pendingCam == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) pendingCam.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else pendingCam.deny();
        pendingCam = null;
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.mizanBack&&window.mizanBack())?'1':'0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (v != null && v.contains("1")) return; // عولج داخل التطبيق
                long now = System.currentTimeMillis();
                if (now - lastBack < 2000) {
                    finish();
                } else {
                    lastBack = now;
                    toast("اضغط رجوع مرة أخرى للخروج");
                }
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.Mizan&&Mizan.flush()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
