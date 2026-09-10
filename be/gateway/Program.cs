using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Ocelot.DependencyInjection;
using Ocelot.Middleware;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddJsonFile("ocelot.json", optional: false, reloadOnChange: true);
builder.Services.AddHttpClient("readiness", client => client.Timeout = TimeSpan.FromSeconds(3));
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .AllowAnyHeader()
        .AllowAnyMethod()
        .SetIsOriginAllowed(_ => true)
        .WithExposedHeaders("x-request-id")
        .AllowCredentials());
});
builder.Services.AddOcelot(builder.Configuration);

var app = builder.Build();
var requestIdPattern = new Regex(
    "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    RegexOptions.Compiled | RegexOptions.IgnoreCase);

app.UseCors();
app.Use(async (context, next) =>
{
    var suppliedRequestId = context.Request.Headers["x-request-id"].FirstOrDefault();
    var requestId = suppliedRequestId is not null && requestIdPattern.IsMatch(suppliedRequestId)
        ? suppliedRequestId
        : Guid.NewGuid().ToString();

    context.Request.Headers["x-request-id"] = requestId;
    context.Response.Headers["x-request-id"] = requestId;

    if (context.Request.Path == "/health/live" || context.Request.Path == "/")
    {
        await context.Response.WriteAsJsonAsync(new
        {
            data = new { status = "ok", service = "clinic-gateway" },
            meta = new { },
            requestId
        });
        return;
    }

    if (context.Request.Path == "/health/ready")
    {
        var httpClient = context.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("readiness");
        var dependencies = new ConcurrentDictionary<string, object>();

        async Task<bool> ProbeAsync(string name, string url)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Add("x-request-id", requestId);
                using var response = await httpClient.SendAsync(request, context.RequestAborted);
                dependencies[name] = new { status = response.IsSuccessStatusCode ? "up" : "down" };
                return response.IsSuccessStatusCode;
            }
            catch
            {
                dependencies[name] = new { status = "down" };
                return false;
            }
        }

        var probes = await Task.WhenAll(
            ProbeAsync("authService", "http://localhost:4001/health/ready"),
            ProbeAsync("clinicService", "http://localhost:4002/health/ready"));

        if (probes.All(isReady => isReady))
        {
            await context.Response.WriteAsJsonAsync(new
            {
                data = new { status = "ready", service = "clinic-gateway", dependencies },
                meta = new { },
                requestId
            });
        }
        else
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new
            {
                error = new
                {
                    code = "DEPENDENCY_UNAVAILABLE",
                    message = "Gateway chưa kết nối được đầy đủ dịch vụ phụ thuộc.",
                    details = new { dependencies }
                },
                requestId
            });
        }
        return;
    }

    await next();
});

await app.UseOcelot();
await app.RunAsync();
