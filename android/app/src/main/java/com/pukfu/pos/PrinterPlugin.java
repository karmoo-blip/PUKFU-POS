package com.pukfu.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * ส่งคำสั่ง ESC/POS ที่ app.js สร้างไว้แล้วไปยังเครื่องพิมพ์ใบเสร็จ
 * ผ่านสาย LAN (TCP พอร์ต 9100) หรือบลูทูธแบบ classic (SPP) ซึ่ง WebView ของ Android ทำเองไม่ได้
 * ฝั่ง JS เรียกผ่าน window.Capacitor.nativePromise('PukfuPrinter', ...)
 */
@CapacitorPlugin(
    name = "PukfuPrinter",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class PrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int DEFAULT_PORT = 9100;
    private static final int CONNECT_TIMEOUT_MS = 4000;
    private static final int WRITE_TIMEOUT_MS = 10000;

    // เธรดเดียว งานพิมพ์จึงเรียงคิวกัน ใบเสร็จกับใบสั่งครัวที่ส่งติดกันจะไม่ปนกันกลางทาง
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    // เก็บการเชื่อมต่อบลูทูธค้างไว้ ต่อใหม่ทุกใบใช้เวลาเป็นวินาที (แตะเฉพาะในเธรด worker)
    private final Map<String, BluetoothSocket> btSockets = new HashMap<>();

    @PluginMethod
    public void lanCheck(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", DEFAULT_PORT);
        if (host == null || host.trim().isEmpty()) {
            call.reject("ยังไม่ได้ใส่ IP");
            return;
        }
        worker.execute(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host.trim(), port), CONNECT_TIMEOUT_MS);
                call.resolve();
            } catch (IOException | IllegalArgumentException e) {
                call.reject("ต่อเครื่องพิมพ์ที่ " + host + " ไม่ได้", e);
            }
        });
    }

    @PluginMethod
    public void lanSend(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", DEFAULT_PORT);
        byte[] data = decodeData(call);
        if (data == null) return;
        if (host == null || host.trim().isEmpty()) {
            call.reject("ยังไม่ได้ใส่ IP");
            return;
        }
        worker.execute(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host.trim(), port), CONNECT_TIMEOUT_MS);
                socket.setSoTimeout(WRITE_TIMEOUT_MS);
                OutputStream out = socket.getOutputStream();
                out.write(data);
                out.flush();
                socket.shutdownOutput();
                call.resolve();
            } catch (IOException | IllegalArgumentException e) {
                call.reject("ส่งไปเครื่องพิมพ์ที่ " + host + " ไม่ได้", e);
            }
        });
    }

    @PluginMethod
    public void btList(PluginCall call) {
        if (needsBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "btListAfterPermission");
            return;
        }
        listBonded(call);
    }

    @PermissionCallback
    private void btListAfterPermission(PluginCall call) {
        if (needsBluetoothPermission()) {
            call.reject("ไม่ได้รับอนุญาตให้ใช้บลูทูธ");
            return;
        }
        listBonded(call);
    }

    @PluginMethod
    public void btSend(PluginCall call) {
        if (needsBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "btSendAfterPermission");
            return;
        }
        sendBluetooth(call);
    }

    @PermissionCallback
    private void btSendAfterPermission(PluginCall call) {
        if (needsBluetoothPermission()) {
            call.reject("ไม่ได้รับอนุญาตให้ใช้บลูทูธ");
            return;
        }
        sendBluetooth(call);
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        worker.execute(() -> {
            for (String address : btSockets.keySet().toArray(new String[0])) closeBluetooth(address);
        });
        worker.shutdown();
    }

    // Android 12 ขึ้นไปต้องขอสิทธิ์ BLUETOOTH_CONNECT ตอนใช้งาน รุ่นเก่ากว่านั้นได้สิทธิ์ตั้งแต่ติดตั้ง
    private boolean needsBluetoothPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter bluetoothAdapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private byte[] decodeData(PluginCall call) {
        String base64 = call.getString("data");
        if (base64 == null || base64.isEmpty()) {
            call.reject("ไม่มีข้อมูลให้พิมพ์");
            return null;
        }
        try {
            return Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("ข้อมูลพิมพ์เสีย", e);
            return null;
        }
    }

    @SuppressLint("MissingPermission")
    private void listBonded(PluginCall call) {
        BluetoothAdapter adapter = bluetoothAdapter();
        if (adapter == null) {
            call.reject("เครื่องนี้ไม่มีบลูทูธ");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("บลูทูธปิดอยู่ เปิดบลูทูธก่อน");
            return;
        }
        JSArray devices = new JSArray();
        for (BluetoothDevice device : adapter.getBondedDevices()) {
            JSObject item = new JSObject();
            String name = device.getName();
            item.put("name", name == null || name.isEmpty() ? device.getAddress() : name);
            item.put("address", device.getAddress());
            devices.put(item);
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @SuppressLint("MissingPermission")
    private void sendBluetooth(PluginCall call) {
        String address = call.getString("address");
        byte[] data = decodeData(call);
        if (data == null) return;
        BluetoothAdapter adapter = bluetoothAdapter();
        if (adapter == null) {
            call.reject("เครื่องนี้ไม่มีบลูทูธ");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("บลูทูธปิดอยู่ เปิดบลูทูธก่อน");
            return;
        }
        if (address == null || address.isEmpty()) {
            call.reject("ยังไม่ได้เลือกเครื่องพิมพ์บลูทูธ");
            return;
        }
        worker.execute(() -> {
            try {
                writeBluetooth(adapter, address, data);
                call.resolve();
            } catch (Exception first) {
                // การเชื่อมต่อที่ค้างไว้อาจตายไปแล้ว (เครื่องพิมพ์ปิด/เปิดใหม่) ต่อใหม่แล้วลองอีกครั้งเดียว
                closeBluetooth(address);
                try {
                    writeBluetooth(adapter, address, data);
                    call.resolve();
                } catch (Exception e) {
                    closeBluetooth(address);
                    call.reject("ส่งไปเครื่องพิมพ์บลูทูธไม่ได้ ตรวจว่าเครื่องพิมพ์เปิดอยู่", e);
                }
            }
        });
    }

    @SuppressLint("MissingPermission")
    private void writeBluetooth(BluetoothAdapter adapter, String address, byte[] data) throws IOException {
        BluetoothSocket socket = btSockets.get(address);
        if (socket == null || !socket.isConnected()) {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
            btSockets.put(address, socket);
        }
        OutputStream out = socket.getOutputStream();
        out.write(data);
        out.flush();
    }

    private void closeBluetooth(String address) {
        BluetoothSocket socket = btSockets.remove(address);
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {}
    }
}
