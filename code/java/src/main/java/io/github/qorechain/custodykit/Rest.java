// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Minimal REST access for the examples and the live checks. Production systems should query their own node. */
public final class Rest {
    public static final String DEFAULT_TESTNET_REST = "https://api-testnet.qore.host";

    private static final HttpClient CLIENT =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();

    private Rest() {}

    /** GET a JSON document from {@code rest + path}. Throws on a non-2xx status. */
    public static JsonObject getJson(String rest, String path) throws IOException, InterruptedException {
        String url = rest.replaceAll("/+$", "") + path;
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(60))
                .header("accept", "application/json")
                .header("user-agent", "qorechain-custody-kit")
                .GET()
                .build();
        HttpResponse<String> res = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() / 100 != 2) throw new IOException("GET " + url + ": HTTP " + res.statusCode());
        return JsonParser.parseString(res.body()).getAsJsonObject();
    }
}
