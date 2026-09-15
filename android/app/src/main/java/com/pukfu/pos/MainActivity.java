package com.pukfu.pos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ต้องลงทะเบียนปลั๊กอินของแอปเองก่อน super.onCreate ไม่งั้นหน้าเว็บจะเรียก PukfuPrinter ไม่เจอ
        registerPlugin(PrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
