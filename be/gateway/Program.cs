using Ocelot.DependencyInjection;
using Ocelot.Middleware;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddJsonFile("ocelot.json", optional: false, reloadOnChange: true);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .AllowAnyHeader()
        .AllowAnyMethod()
        .SetIsOriginAllowed(_ => true)
        .AllowCredentials());
});
builder.Services.AddOcelot(builder.Configuration);

var app = builder.Build();

app.UseCors();
app.Use(async (context, next) =>
{
    if (context.Request.Path == "/health/live")
    {
        await context.Response.WriteAsJsonAsync(new { status = "ok", service = "clinic-gateway" });
        return;
    }

    if (context.Request.Path == "/")
    {
        await context.Response.WriteAsJsonAsync(new { status = "ok", service = "clinic-gateway" });
        return;
    }

    await next();
});

await app.UseOcelot();
await app.RunAsync();
